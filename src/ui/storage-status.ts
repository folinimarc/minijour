import { icon } from './icons';
import type { JournalUI } from './shell';

type StorageIcon = 'device' | 'device-check' | 'device-alert' | 'cloud-check' | 'cloud-alert' | 'cloud-sync';
export type StorageStatus = { icon: StorageIcon; text: string; busy?: boolean; warning?: boolean };
export type StorageState = {
  saveError: boolean; saving: boolean; unsaved: boolean; cleaning: boolean;
  connected: boolean; available: boolean; unlocked: boolean; cloudWorking: boolean;
  syncing: boolean; syncError: boolean; online: boolean; synced: boolean; cloudName?: string;
};

/** A checkmark always means the current edits have actually been saved. */
export function storageStatus(state: StorageState): StorageStatus {
  if (state.saveError) return { icon: 'device-alert', text: 'Could not save on this device', warning: true };
  if (state.saving) return { icon: 'device', text: 'Saving…', busy: true };
  if (state.unsaved) return { icon: 'device', text: 'Changes waiting to save…' };
  if (state.cleaning) return { icon: state.connected ? 'cloud-sync' : 'device', text: 'Saved on device · updating photos…', busy: true };
  if (state.syncing) return { icon: 'cloud-sync', text: 'Saved on device · syncing…', busy: true };
  if (!state.connected) return { icon: 'device-check', text: state.online ? 'Saved on this device only' : 'Saved on device · offline' };
  if (!state.online) return { icon: 'cloud-alert', text: 'Saved on device · offline', warning: true };
  if (state.syncError) return { icon: 'cloud-alert', text: 'Saved on device · sync needs attention', warning: true };
  if (state.cloudWorking && !state.unlocked) return { icon: 'cloud-sync', text: state.available ? 'Unlocking cloud…' : 'Checking cloud…', busy: true };
  if (!state.available) return { icon: 'cloud-alert', text: 'Cloud storage unavailable', warning: true };
  if (!state.unlocked) return { icon: 'cloud-alert', text: 'Cloud storage locked', warning: true };
  return state.synced
    ? { icon: 'cloud-check', text: `Saved to ${state.cloudName || 'cloud'}` }
    : { icon: 'cloud-sync', text: 'Saved on device · waiting to sync' };
}

/** The header is compact; the same symbol and explanation appear in settings. */
export function renderStorageStatus(ui: JournalUI, status: StorageStatus): void {
  if (ui.statusButton.dataset.icon !== status.icon) {
    const svg = icon(status.icon);
    ui.statusIcon.innerHTML = svg; ui.cloudStatusIcon.innerHTML = svg;
    ui.statusButton.dataset.icon = status.icon;
    ui.cloudStatus.dataset.icon = status.icon;
  }
  ui.statusButton.classList.toggle('has-warning', !!status.warning);
  ui.statusButton.classList.toggle('is-busy', !!status.busy);
  ui.cloudStatus.classList.toggle('has-warning', !!status.warning);
  ui.statusButton.title = status.text;
  ui.statusText.textContent = status.text;
  ui.cloudStatusText.textContent = status.text;
}
