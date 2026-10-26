import * as A from '@automerge/automerge';
import { heads, isDate, loadDay, mergeDays, type DayDoc } from '../domain/day';
import type { Journal } from '../domain/journal';
import type { CloudFiles, RemoteFile } from './cloud';
import { PHOTO_NAME, PHOTO_DELETION_PATH, photoType, decodePhotoDeletions, encodePhotoDeletions } from '../domain/photos';

const DAY_PATH = /^\/days\/(\d{4}-\d{2}-\d{2})\/([a-f0-9-]+)\.automerge$/;

/**
 * Each running app owns one checkpoint per changed day. Separate writers never
 * overwrite each other's files. A checkpoint includes Automerge's full history,
 * so an offline device can merge later without needing any other device online.
 * We retain checkpoints: deletion/garbage collection is intentionally omitted.
 */
export class SyncEngine {
  private cache = new Map<string, { revision: string; bytes: Uint8Array; doc?: DayDoc }>();
  private dayCache = new Map<string, { signature: string; doc: DayDoc }>();
  private running?: Promise<void>;
  private rerun = false;

  constructor(
    private journal: Journal,
    private cloud: CloudFiles,
    private writer = crypto.randomUUID(),
  ) {}

  /** Import an older plaintext cloud copy without ever writing back to it. */
  async importOnly(): Promise<void> { await this.round(false); }

  sync(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.rerun = false;
        await this.round();
      } while (this.rerun);
    })().finally(() => { this.running = undefined; });
    return this.running;
  }

  private async round(upload = true): Promise<void> {
    const files = await this.cloud.list();
    const listed = new Set(files.map(file => file.path));
    for (const path of this.cache.keys()) if (!listed.has(path)) this.cache.delete(path);
    const remoteDeleted = new Set<string>();
    // Read deletion records before transferring any photo. Deletion wins over
    // old offline references, restored backups, and in-flight stale uploads.
    for (const file of files) {
      // Legacy plaintext imports predate deletion records. Only the normal
      // encrypted sync path may authorize permanent deletion from cloud data.
      if (!upload) break;
      const match = PHOTO_DELETION_PATH.exec(file.path);
      if (!match) continue;
      const bytes = await this.read(file);
      if (bytes.length > 1024) throw new Error('Invalid photo deletion record.');
      const names = decodePhotoDeletions(bytes);
      if (names.length !== 1 || names[0] !== match[1]) throw new Error('Photo deletion record does not match its path.');
      remoteDeleted.add(match[1]);
    }
    await this.journal.deletePhotos(remoteDeleted);
    const remoteDays = new Map<string, DayDoc>();
    const checkpoints = new Map<string, RemoteFile[]>();
    for (const file of files) {
      const match = DAY_PATH.exec(file.path);
      if (!match || !isDate(match[1])) continue;
      const group = checkpoints.get(match[1]) ?? [];
      group.push(file);
      checkpoints.set(match[1], group);
    }
    for (const date of this.dayCache.keys()) if (!checkpoints.has(date)) this.dayCache.delete(date);

    // Pull first. Merging is synchronous; edits made during network requests are
    // merged with the latest in-memory copy rather than replacing the editor.
    for (const [date, group] of checkpoints) {
      const doc = await this.remoteDay(date, group);
      remoteDays.set(date, doc);
      // Always offer the cached result: local typing and failed saves may have
      // changed since the last round. Journal cheaply skips identical versions.
      await this.journal.mergeDoc(date, doc);
    }

    const deleted = await this.journal.local.photoDeletions();
    if (upload) {
      // Make each deletion durable remotely BEFORE removing its photo. A failed
      // publication leaves the photo remote and retries from the local record.
      for (const name of deleted) {
        if (!remoteDeleted.has(name)) await this.cloud.upload(`/deleted-photos/${name}.json`, encodePhotoDeletions([name]));
      }
      for (const file of files) {
        if (file.path.startsWith('/photos/') && deleted.has(file.path.slice(8))) await this.cloud.remove(file.path);
      }
    }
    const remotePhotos = new Set(files.filter(file => file.path.startsWith('/photos/'))
      .map(file => file.path.slice('/photos/'.length)).filter(name => PHOTO_NAME.test(name)));
    let photosChanged = false;
    for (const name of remotePhotos) {
      if ((await this.journal.local.photoDeletions()).has(name)) continue;
      if (await this.journal.local.photo(name)) continue;
      const bytes = await this.cloud.download(`/photos/${name}`);
      photosChanged = await this.journal.local.savePhoto(name, new Blob([new Uint8Array(bytes)], { type: photoType(name) })) || photosChanged;
    }
    if (photosChanged) this.journal.photosChanged();
    if (!upload) return;

    // Upload photos before documents that might reference them. Photos have
    // unique immutable names and do not need CRDT merging.
    for (const name of await this.journal.local.photoNames()) {
      if ((await this.journal.local.photoDeletions()).has(name)) continue;
      if (remotePhotos.has(name)) continue;
      const blob = await this.journal.local.photo(name);
      if (blob) await this.cloud.upload(`/photos/${name}`, new Uint8Array(await blob.arrayBuffer()));
    }

    for (const [date, doc] of this.journal.days) {
      const remote = remoteDays.get(date);
      // A fresh app needn't upload the whole journal again. Publish only days
      // with changes not already represented by the remote checkpoints.
      if (remote && heads(remote) === heads(doc)) continue;
      const checkpoint = A.clone(doc);
      const bytes = A.save(checkpoint);
      const file = await this.cloud.upload(`/days/${date}/${this.writer}.automerge`, bytes);
      this.cache.set(file.path, { revision: file.revision, bytes, doc: checkpoint });
    }
  }

  private async remoteDay(date: string, files: RemoteFile[]): Promise<DayDoc> {
    files.sort((a, b) => a.path.localeCompare(b.path));
    const signature = JSON.stringify(files.map(file => [file.path, file.revision]));
    const cached = this.dayCache.get(date);
    if (cached?.signature === signature) return cached.doc;
    let doc: DayDoc | undefined;
    // Rebuild only this day when its checkpoint set changes. In particular,
    // removed files must not remain in the cached remote history.
    for (const file of files) {
      const bytes = await this.read(file);
      const checkpoint = this.cache.get(file.path)!;
      try { checkpoint.doc ??= loadDay(bytes); }
      catch (error) { this.cache.delete(file.path); throw error; }
      doc = doc ? mergeDays(doc, checkpoint.doc) : checkpoint.doc;
    }
    this.dayCache.set(date, { signature, doc: doc! });
    return doc!;
  }

  private async read(file: RemoteFile): Promise<Uint8Array> {
    const cached = this.cache.get(file.path);
    if (cached?.revision === file.revision) return cached.bytes;
    const bytes = await this.cloud.download(file.path);
    this.cache.set(file.path, { revision: file.revision, bytes });
    return bytes;
  }
}
