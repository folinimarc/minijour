import type { LocalStore } from '../storage/local';
import type { VaultStorage } from './cloud';

/** Authentication belongs to a provider; encryption and sync use only files. */
export interface CloudSession {
  files: VaultStorage;
  disconnect(): Promise<void>;
}

export interface CloudProvider {
  id: string;
  name: string;
  connect(): Promise<void>;
  finishConnection(local: LocalStore): Promise<boolean>;
  open(local: LocalStore): Promise<CloudSession | undefined>;
}
