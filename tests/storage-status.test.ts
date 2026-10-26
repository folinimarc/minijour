import { expect, it } from 'vitest';
import { storageStatus, type StorageState } from '../src/ui/storage-status';

const local: StorageState = {
  saveError: false, saving: false, unsaved: false, cleaning: false,
  connected: false, available: false, unlocked: false, cloudWorking: false,
  syncing: false, syncError: false, online: true, synced: false,
};
const cloud = { ...local, connected: true, available: true, unlocked: true, synced: true, cloudName: 'Dropbox' };

it('shows a local check only after current edits are durable', () => {
  expect(storageStatus(local).icon).toBe('device-check');
  expect(storageStatus({ ...local, unsaved: true }).icon).toBe('device');
  expect(storageStatus({ ...local, saving: true }).icon).toBe('device');
  expect(storageStatus({ ...local, saveError: true })).toMatchObject({ icon: 'device-alert', warning: true });
});

it('never shows a cloud check for unsaved, queued, or in-flight edits', () => {
  expect(storageStatus(cloud).icon).toBe('cloud-check');
  expect(storageStatus({ ...cloud, unsaved: true }).icon).toBe('device');
  expect(storageStatus({ ...cloud, synced: false }).icon).toBe('cloud-sync');
  expect(storageStatus({ ...cloud, syncing: true })).toMatchObject({ icon: 'cloud-sync', busy: true });
});

it('distinguishes locked cloud, unavailable cloud, offline access, and failed sync', () => {
  expect(storageStatus({ ...cloud, unlocked: false })).toMatchObject({ icon: 'cloud-alert', text: 'Cloud storage locked' });
  expect(storageStatus({ ...cloud, available: false })).toMatchObject({ icon: 'cloud-alert', text: 'Cloud storage unavailable' });
  expect(storageStatus({ ...cloud, online: false })).toMatchObject({ icon: 'cloud-alert', text: expect.stringContaining('offline') });
  expect(storageStatus({ ...cloud, syncError: true })).toMatchObject({ icon: 'cloud-alert', warning: true });
});
