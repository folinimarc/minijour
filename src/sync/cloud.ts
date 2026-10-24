/** The only contract a cloud provider needs to implement. Paths are app-relative. */
export type RemoteFile = { path: string; revision: string };

export interface CloudFiles {
  list(): Promise<RemoteFile[]>;
  download(path: string): Promise<Uint8Array>;
  upload(path: string, bytes: Uint8Array): Promise<RemoteFile>;
  /** Idempotent: an already missing file counts as removed. */
  remove(path: string): Promise<void>;
}

export interface VaultStorage extends CloudFiles {
  /** Atomic create: false means another device already created this path. */
  create(path: string, bytes: Uint8Array): Promise<boolean>;
}
