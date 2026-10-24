import * as A from '@automerge/automerge';
import { heads, isDate, loadDay, mergeDays, type DayDoc } from '../domain/day';
import type { Journal } from '../domain/journal';
import type { CloudFiles, RemoteFile } from './cloud';

const DAY_PATH = /^\/days\/(\d{4}-\d{2}-\d{2})\/([a-f0-9-]+)\.automerge$/;
export const PHOTO_NAME = /^[a-f0-9-]{36}\.jpg$/;

/**
 * Each running app owns one checkpoint per changed day. Separate writers never
 * overwrite each other's files. A checkpoint includes Automerge's full history,
 * so an offline device can merge later without needing any other device online.
 * We retain checkpoints: deletion/garbage collection is intentionally omitted.
 */
export class SyncEngine {
  private cache = new Map<string, { revision: string; bytes: Uint8Array }>();
  private running?: Promise<void>;
  private rerun = false;

  constructor(
    private journal: Journal,
    private cloud: CloudFiles,
    private writer = crypto.randomUUID(),
  ) {}

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

  private async round(): Promise<void> {
    const files = await this.cloud.list();
    const remoteDays = new Map<string, DayDoc>();

    // Pull first. Merging is synchronous; edits made during network requests are
    // merged with the latest in-memory copy rather than replacing the editor.
    for (const file of files) {
      const match = DAY_PATH.exec(file.path);
      if (!match || !isDate(match[1])) continue;
      const bytes = await this.read(file);
      const incoming = loadDay(bytes);
      const previous = remoteDays.get(match[1]);
      remoteDays.set(match[1], previous ? mergeDays(previous, incoming) : incoming);
      await this.journal.merge(match[1], bytes);
    }

    const remotePhotos = new Set(files.filter(file => file.path.startsWith('/photos/'))
      .map(file => file.path.slice('/photos/'.length)).filter(name => PHOTO_NAME.test(name)));
    let photosChanged = false;
    for (const name of remotePhotos) {
      if (await this.journal.local.photo(name)) continue;
      const bytes = await this.cloud.download(`/photos/${name}`);
      await this.journal.local.savePhoto(name, new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
      photosChanged = true;
    }
    if (photosChanged) this.journal.photosChanged();

    // Upload photos before documents that might reference them. Photos have
    // unique immutable names and do not need CRDT merging.
    for (const name of await this.journal.local.photoNames()) {
      if (remotePhotos.has(name)) continue;
      const blob = await this.journal.local.photo(name);
      if (blob) await this.cloud.upload(`/photos/${name}`, new Uint8Array(await blob.arrayBuffer()));
    }

    for (const [date, doc] of this.journal.days) {
      const remote = remoteDays.get(date);
      // A fresh app needn't upload the whole journal again. Publish only days
      // with changes not already represented by the remote checkpoints.
      if (remote && heads(remote) === heads(doc)) continue;
      const bytes = A.save(doc);
      const file = await this.cloud.upload(`/days/${date}/${this.writer}.automerge`, bytes);
      this.cache.set(file.path, { revision: file.revision, bytes });
    }
  }

  private async read(file: RemoteFile): Promise<Uint8Array> {
    const cached = this.cache.get(file.path);
    if (cached?.revision === file.revision) return cached.bytes;
    const bytes = await this.cloud.download(file.path);
    this.cache.set(file.path, { revision: file.revision, bytes });
    return bytes;
  }
}
