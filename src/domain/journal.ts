import * as A from '@automerge/automerge';
import { editDay, isDate, loadDay, type DayDoc } from './day';
import { heads, mergeDocuments } from './documents';
import { createPreferences, loadPreferences, changePhotoOptions, type PreferencesDoc } from './preferences';
import { DEFAULT_PHOTO_OPTIONS, isPhotoOptions, type PhotoOptions } from './photos';
import type { LocalStore } from '../storage/local';

export type ChangeOrigin = 'local' | 'remote';
export type JournalEvent = { date?: string; origin?: ChangeOrigin; photos?: boolean; preferences?: boolean; saved?: boolean; error?: Error };

/** The small application model: optimistic editing, durable saves, and events. */
export class Journal {
  readonly days = new Map<string, DayDoc>();
  preferences = createPreferences();
  private listeners = new Set<(event: JournalEvent) => void>();
  private channel?: BroadcastChannel;
  private unsaved = new Map<string, number>();
  private revision = 0;
  private saving?: Promise<void>;
  pending = 0;
  saveError?: Error;

  constructor(readonly local: LocalStore, channelName = 'minijour-v1') {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(channelName);
      this.channel.onmessage = event => {
        const { date, bytes } = event.data;
        if (typeof date === 'string' && isDate(date) && bytes instanceof Uint8Array) {
          this.accept(date, loadDay(bytes));
        } else if (event.data.preferences instanceof Uint8Array) this.acceptPreferences(loadPreferences(event.data.preferences));
        else if (event.data.photo) this.emit({ photos: true });
      };
    }
  }

  async load(): Promise<void> {
    for (const [date, bytes] of await this.local.days()) {
      if (!isDate(date)) throw new Error('Invalid date in local journal.');
      this.days.set(date, loadDay(bytes));
    }
    await this.refreshPreferences();
    // Carry an explicitly chosen setting from the previous device-local UI.
    if (!this.preferences.photoOptions) {
      const previous = await this.local.setting<unknown>('photo-options');
      if (isPhotoOptions(previous)) {
        try { await this.setPhotoOptions(previous); }
        catch (error) {
          // The old choice is already durable. Full storage must not prevent
          // opening/exporting the journal or switch original photos to JPEG.
          if (!this.preferences.photoOptions) this.preferences = changePhotoOptions(this.preferences, previous);
          this.saveError = error instanceof Error ? error : new Error('Could not save journal preferences.');
        }
      }
    }
  }

  subscribe(listener: (event: JournalEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: JournalEvent): void {
    this.listeners.forEach(listener => listener(event));
  }

  get hasUnsavedChanges(): boolean { return this.unsaved.size > 0; }

  private accept(date: string, incoming: DayDoc, origin: ChangeOrigin = 'remote', needsSave = false): boolean {
    const previous = this.days.get(date);
    // Compare the document versions, not the shared backend's known history:
    // an editor can hold an older view of a backend with newer changes in it.
    if (previous && heads(previous) === heads(incoming)) return false;
    const next = previous ? mergeDocuments(previous, incoming) : A.clone(incoming);
    if (previous && heads(previous) === heads(next)) return false;
    this.days.set(date, next);
    if (needsSave) this.unsaved.set(date, ++this.revision);
    this.emit({ date, origin });
    return true;
  }

  /** Keep typing in memory; the autosave coordinator decides when to write. */
  stage(date: string, doc: DayDoc): void {
    if (!isDate(date)) throw new Error('Invalid journal date.');
    this.accept(date, doc, 'local', true);
  }

  async edit(date: string, text: string): Promise<void> {
    const doc = this.days.get(date);
    if (!doc || doc.text === text) return;
    this.days.set(date, editDay(doc, text));
    this.unsaved.set(date, ++this.revision);
    this.emit({ date, origin: 'local' });
    await this.flush();
  }

  async merge(date: string, bytes: Uint8Array): Promise<void> {
    await this.mergeDoc(date, loadDay(bytes));
  }

  /** Sync can reuse a validated, decoded checkpoint without serializing it again. */
  async mergeDoc(date: string, doc: DayDoc): Promise<void> {
    if (!isDate(date)) throw new Error('Invalid journal date.');
    const changed = this.accept(date, doc, 'remote', true);
    // A previous attempt may have merged successfully but failed to save.
    if (changed || this.unsaved.has(date)) await this.flush();
  }

  async flush(): Promise<void> {
    while (this.saving) await this.saving;
    if (!this.unsaved.size) return;
    // Capture one batch. Later edits keep their own revision and remain pending.
    const batch = [...this.unsaved].map(([date, revision]) => ({ date, revision, doc: A.clone(this.days.get(date)!) }));
    this.saving = (async () => {
      for (const { date, revision, doc } of batch) await this.persist(date, revision, doc);
    })();
    try { await this.saving; } finally { this.saving = undefined; }
  }

  private async persist(date: string, revision: number, doc: DayDoc): Promise<void> {
    this.pending++;
    this.emit({});
    try {
      const bytes = A.save(doc);
      const saved = await this.local.saveDay(date, bytes);
      this.accept(date, loadDay(saved));
      this.channel?.postMessage({ date, bytes: saved });
      if (this.unsaved.get(date) === revision) this.unsaved.delete(date);
      this.saveError = undefined;
      this.emit({ saved: true });
    } catch (error) {
      this.saveError = error instanceof Error ? error : new Error('Could not save on this device.');
      this.emit({ error: this.saveError });
      throw this.saveError;
    } finally {
      this.pending--;
      this.emit({});
    }
  }

  photosChanged(): void {
    this.channel?.postMessage({ photo: true });
    this.emit({ photos: true });
  }

  async deletePhotos(names: Iterable<string>, options: { onlyUnused?: boolean } = {}): Promise<string[]> {
    if (options.onlyUnused) await this.flush();
    const removed = await this.local.deletePhotos(names, options);
    if (removed.length) this.photosChanged();
    return removed;
  }

  get photoOptions(): PhotoOptions { return { ...(this.preferences.photoOptions ?? DEFAULT_PHOTO_OPTIONS) }; }

  private acceptPreferences(incoming: PreferencesDoc): void {
    if (heads(this.preferences) === heads(incoming)) return;
    const next = mergeDocuments(this.preferences, incoming);
    if (heads(next) === heads(this.preferences)) return;
    this.preferences = next;
    this.emit({ preferences: true });
  }

  async refreshPreferences(): Promise<void> {
    const bytes = await this.local.preferences();
    if (bytes) this.acceptPreferences(loadPreferences(bytes));
  }

  async setPhotoOptions(options: PhotoOptions): Promise<void> {
    await this.refreshPreferences();
    const next = changePhotoOptions(this.preferences, options);
    await this.savePreferences(next);
  }

  async mergePreferences(incoming: PreferencesDoc): Promise<void> {
    if (heads(this.preferences) === heads(incoming)) return;
    const next = mergeDocuments(this.preferences, incoming);
    if (heads(next) !== heads(this.preferences)) await this.savePreferences(next);
  }

  private async savePreferences(doc: PreferencesDoc): Promise<void> {
    // Explicit settings changes are small and save immediately. Adopt only a
    // successful write, so a failed setting can roll back without losing text.
    const saved = await this.local.savePreferences(A.save(doc));
    if (!this.hasUnsavedChanges && !this.pending) this.saveError = undefined;
    this.acceptPreferences(loadPreferences(saved));
    this.channel?.postMessage({ preferences: saved });
  }

  close(): void { this.channel?.close(); }
}
