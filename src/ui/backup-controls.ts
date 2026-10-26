import { localDate } from '../domain/day';
import type { Journal } from '../domain/journal';
import { exportJournal, importJournal } from '../storage/backup';
import type { JournalUI } from './shell';

/** Backups use the same journal model and emit its normal change events. */
export function setupBackupControls(ui: JournalUI, journal: Journal, notify: (error: unknown) => void): void {
  async function download(): Promise<void> {
    ui.export.disabled = true;
    try {
      const blob = await exportJournal(journal);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `minijour-${localDate()}.zip`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } finally { ui.export.disabled = false; }
  }

  async function restore(): Promise<void> {
    const file = ui.restoreInput.files?.[0];
    ui.restoreInput.value = '';
    if (!file) return;
    await importJournal(journal, file);
    notify('Backup restored. Its entries have been combined with your journal.');
  }

  ui.export.onclick = () => { void download().catch(notify); };
  ui.restore.onclick = () => ui.restoreInput.click();
  ui.restoreInput.onchange = () => { void restore().catch(notify); };
}
