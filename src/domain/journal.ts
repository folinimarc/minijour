import * as A from '@automerge/automerge';
import { createDay, editDay, heads, isDate, loadDay, mergeDays, type DayDoc } from './day';
import type { LocalStore } from '../storage/local';

export type JournalEvent = { date?: string; photos?: boolean; error?: Error };

/** The small application model: optimistic editing, durable saves, and events. */
export class Journal {
  readonly days = new Map<string, DayDoc>();
  private listeners = new Set<(event: JournalEvent) => void>();
  private channel?: BroadcastChannel;
  pending = 0;
  saveError?: Error;

  constructor(readonly local: LocalStore, channelName = 'minijour-v1') {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(channelName);
      this.channel.onmessage = event => {
        const { date, bytes } = event.data;
        if (typeof date === 'string' && isDate(date) && bytes instanceof Uint8Array) {
          this.accept(date, loadDay(bytes));
        } else if (event.data.photo) this.emit({ photos: true });
      };
    }
  }

  async load(): Promise<void> {
    for (const [date, bytes] of await this.local.days()) {
      if (!isDate(date)) throw new Error('Invalid date in local journal.');
      this.days.set(date, loadDay(bytes));
    }
  }

  subscribe(listener: (event: JournalEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: JournalEvent): void {
    this.listeners.forEach(listener => listener(event));
  }

  private accept(date: string, incoming: DayDoc): boolean {
    const previous = this.days.get(date);
    const next = previous ? mergeDays(previous, incoming) : incoming;
    if (previous && heads(previous) === heads(next)) return false;
    this.days.set(date, next);
    this.emit({ date });
    return true;
  }

  async ensureDay(date: string): Promise<void> {
    if (this.days.has(date)) return;
    this.days.set(date, createDay(date));
    this.emit({ date });
    await this.persist(date);
  }

  async edit(date: string, text: string): Promise<void> {
    const doc = this.days.get(date);
    if (!doc || doc.text === text) return;
    this.days.set(date, editDay(doc, text));
    this.emit({ date });
    await this.persist(date);
  }

  async merge(date: string, bytes: Uint8Array): Promise<void> {
    if (!isDate(date)) throw new Error('Invalid journal date.');
    if (this.accept(date, loadDay(bytes))) await this.persist(date);
  }

  async flush(): Promise<void> {
    // Also retries any optimistic changes left in memory after a storage error.
    for (const date of this.days.keys()) await this.persist(date);
  }

  private async persist(date: string): Promise<void> {
    const bytes = A.save(this.days.get(date)!);
    this.pending++;
    this.emit({});
    try {
      const saved = await this.local.saveDay(date, bytes);
      this.accept(date, loadDay(saved));
      this.channel?.postMessage({ date, bytes: saved });
      this.saveError = undefined;
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

  close(): void { this.channel?.close(); }
}
