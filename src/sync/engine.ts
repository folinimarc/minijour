import * as A from '@automerge/automerge';
import { isDate, loadDay, type DayDoc } from '../domain/day';
import { heads, mergeDocuments } from '../domain/documents';
import type { Journal } from '../domain/journal';
import type { CloudFiles, RemoteFile } from './cloud';
import { MissingRemoteFile } from './cloud';
import { PHOTO_NAME, PHOTO_DELETION_PATH, photoType, decodePhotoDeletions, encodePhotoDeletions } from '../domain/photos';
import { createPreferences, loadPreferences, type PreferencesDoc } from '../domain/preferences';
import { downloadInParallel } from './downloads';

const DAY_PATH = /^\/days\/(\d{4}-\d{2}-\d{2})\/([a-f0-9-]+)\.automerge$/;
const PREFERENCES_PATH = /^\/preferences\/[a-f0-9-]{36}\.automerge$/;

/**
 * Snapshots contain full Automerge history and are never rewritten. Publish a
 * replacement before removing only the snapshots included in that history.
 * Concurrent uploads remain for a later round; offline devices can still merge.
 */
export class SyncEngine {
  private cache = new Map<string, { revision: string; bytes: Uint8Array; doc?: DayDoc; preferences?: PreferencesDoc }>();
  private dayCache = new Map<string, { signature: string; doc: DayDoc }>();
  private running?: Promise<void>;
  private rerun = false;

  constructor(
    private journal: Journal,
    private cloud: CloudFiles,
  ) {}

  sync(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.rerun = false;
        try { await this.round(); }
        catch (error) {
          if (!(error instanceof MissingRemoteFile)) throw error;
          // A peer can consolidate between listing and downloading. Refresh
          // once, after the download queue has drained; other failures surface.
          await this.round();
        }
      } while (this.rerun);
    })().finally(() => { this.running = undefined; });
    return this.running;
  }

  private async round(): Promise<void> {
    const files = await this.cloud.list();
    const listed = new Set(files.map(file => file.path));
    for (const path of this.cache.keys()) if (!listed.has(path)) this.cache.delete(path);
    let remotePreferences = createPreferences();
    // Fetch preferences first, so a newly connected device adopts the stored
    // photo policy before downloading the rest of its journal.
    const preferenceFiles = files.filter(file => PREFERENCES_PATH.test(file.path));
    await downloadInParallel(preferenceFiles, file => this.read(file));
    for (const file of preferenceFiles) {
      const bytes = await this.read(file);
      const checkpoint = this.cache.get(file.path)!;
      try { checkpoint.preferences ??= loadPreferences(bytes); }
      catch (error) { this.cache.delete(file.path); throw error; }
      remotePreferences = mergeDocuments(remotePreferences, checkpoint.preferences);
    }
    await this.journal.mergePreferences(remotePreferences);
    const remoteDeleted = new Set<string>();
    // Read deletion records before transferring any photo. Deletion wins over
    // old offline references, restored backups, and in-flight stale uploads.
    const deletionFiles = files.filter(file => PHOTO_DELETION_PATH.test(file.path));
    await downloadInParallel(deletionFiles, file => this.read(file));
    for (const file of deletionFiles) {
      const match = PHOTO_DELETION_PATH.exec(file.path)!;
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

    // Download independently, then decode and merge in the existing order.
    // One shared queue keeps the limit at four across all day snapshots.
    await downloadInParallel([...checkpoints.values()].flat(), file => this.read(file));

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
    // Make each deletion durable remotely BEFORE removing its photo. A failed
    // publication leaves the photo remote and retries from the local record.
    for (const name of deleted) {
      if (!remoteDeleted.has(name)) await this.cloud.upload(`/deleted-photos/${name}.json`, encodePhotoDeletions([name]));
    }
    for (const file of files) {
      if (file.path.startsWith('/photos/') && deleted.has(file.path.slice(8))) await this.cloud.remove(file.path);
    }
    const remotePhotos = new Set(files.filter(file => file.path.startsWith('/photos/'))
      .map(file => file.path.slice('/photos/'.length)).filter(name => PHOTO_NAME.test(name)));
    let photosChanged = false;
    try {
      await downloadInParallel([...remotePhotos], async name => {
        if ((await this.journal.local.photoDeletions()).has(name)) return;
        if (await this.journal.local.photo(name)) return;
        const bytes = await this.cloud.download(`/photos/${name}`);
        // Persist each photo immediately rather than retaining a whole batch.
        const saved = await this.journal.local.savePhoto(name, new Blob([new Uint8Array(bytes)], { type: photoType(name) }));
        if (saved) photosChanged = true;
      });
    } finally {
      // Successful downloads remain usable even if another photo failed.
      if (photosChanged) this.journal.photosChanged();
    }

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
      // Publish changed days or consolidate several snapshots into one. An
      // unchanged day already represented by one snapshot needs no upload.
      const previous = checkpoints.get(date) ?? [];
      if (remote && heads(remote) === heads(doc) && previous.length === 1) continue;
      const checkpoint = A.clone(doc);
      const bytes = A.save(checkpoint);
      const file = await this.cloud.upload(`/days/${date}/${crypto.randomUUID()}.automerge`, bytes);
      this.cache.set(file.path, { revision: file.revision, bytes, doc: checkpoint });
      this.dayCache.set(date, { signature: JSON.stringify([[file.path, file.revision]]), doc: checkpoint });
      await this.removeSnapshots(previous);
    }

    const preferences = this.journal.preferences;
    if (preferences.photoOptions && (heads(preferences) !== heads(remotePreferences) || preferenceFiles.length !== 1)) {
      const checkpoint = A.clone(preferences);
      const bytes = A.save(checkpoint);
      const file = await this.cloud.upload(`/preferences/${crypto.randomUUID()}.automerge`, bytes);
      this.cache.set(file.path, { revision: file.revision, bytes, preferences: checkpoint });
      await this.removeSnapshots(preferenceFiles);
    }
  }

  private async removeSnapshots(files: RemoteFile[]): Promise<void> {
    // These immutable paths were read and merged into the uploaded snapshot.
    // Never use a fresh folder listing here: it could include concurrent edits.
    for (const file of files) {
      await this.cloud.remove(file.path);
      this.cache.delete(file.path);
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
      doc = doc ? mergeDocuments(doc, checkpoint.doc) : checkpoint.doc;
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
