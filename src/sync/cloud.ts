/** Remote file operations used by sync and encryption. Paths are app-relative. */
export type RemoteFile = { path: string; revision: string };

/** Another device may consolidate or delete a file after our folder listing. */
export class MissingRemoteFile extends Error {
  constructor(path: string) { super(`Cloud file is no longer available: ${path}`); }
}

export interface CloudFiles {
  list(): Promise<RemoteFile[]>;
  /** Throw MissingRemoteFile when the listed file has since been removed. */
  download(path: string): Promise<Uint8Array>;
  upload(path: string, bytes: Uint8Array): Promise<RemoteFile>;
  /** Idempotent: an already missing file counts as removed. */
  remove(path: string): Promise<void>;
}

export interface VaultStorage extends CloudFiles {
  /** Atomic create: false means another device already created this path. */
  create(path: string, bytes: Uint8Array): Promise<boolean>;
}
