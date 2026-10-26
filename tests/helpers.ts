import type { VaultStorage, RemoteFile } from '../src/sync/cloud';
import { MissingRemoteFile } from '../src/sync/cloud';
import type { Journal } from '../src/domain/journal';
import { createDay } from '../src/domain/day';

/** A saved empty day for tests; the UI keeps blank drafts outside the journal. */
export async function addDay(journal: Journal, date: string): Promise<void> {
  if (journal.days.has(date)) return;
  journal.stage(date, createDay(date));
  await journal.flush();
}

export class MemoryCloud implements VaultStorage {
  files = new Map<string, { bytes: Uint8Array; revision: string }>();
  uploads = 0;
  async create(path: string, bytes: Uint8Array): Promise<boolean> {
    if (this.files.has(path)) return false;
    await this.upload(path, bytes);
    return true;
  }
  async remove(path: string): Promise<void> { this.files.delete(path); }
  async list(): Promise<RemoteFile[]> {
    return [...this.files].map(([path, file]) => ({ path, revision: file.revision }));
  }
  async download(path: string): Promise<Uint8Array> {
    const file = this.files.get(path);
    if (!file) throw new MissingRemoteFile(path);
    return file.bytes.slice();
  }
  async upload(path: string, bytes: Uint8Array): Promise<RemoteFile> {
    this.uploads++;
    const revision = String(this.uploads);
    this.files.set(path, { bytes: bytes.slice(), revision });
    return { path, revision };
  }
}

