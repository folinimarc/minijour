/** The only contract a cloud provider needs to implement. Paths are app-relative. */
export type RemoteFile = { path: string; revision: string };

export interface CloudFiles {
  list(): Promise<RemoteFile[]>;
  download(path: string): Promise<Uint8Array>;
  upload(path: string, bytes: Uint8Array): Promise<RemoteFile>;
}
