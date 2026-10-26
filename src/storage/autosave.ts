/** One idle save timer. Only failed saves schedule a delayed retry. */
export class Autosave {
  private idle?: ReturnType<typeof setTimeout>;
  private running = false;
  private closed = false;
  private revision = 0;
  private lastEdit = -Infinity;

  constructor(
    private save: () => Promise<void>,
    private hasChanges: () => boolean,
    private onError: (error: unknown) => void,
  ) {}

  changed(): void {
    this.revision++;
    this.schedule();
  }

  edited(): void {
    this.lastEdit = performance.now();
    this.changed();
  }

  get isIdle(): boolean { return performance.now() - this.lastEdit >= 1500; }

  /** Also used when an explicit action fails to save locally. */
  retry(): void { if (!this.idle) this.schedule(10_000); }

  private schedule(delay = 1500): void {
    if (this.closed) return;
    clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      this.idle = undefined;
      void this.checkpoint();
    }, delay);
  }

  private async checkpoint(): Promise<void> {
    if (this.closed || this.running || !this.hasChanges()) return;
    if (!this.isIdle) { this.schedule(); return; }
    this.running = true;
    const revision = this.revision;
    try {
      await this.save();
    } catch (error) { this.retry(); this.onError(error); }
    finally {
      this.running = false;
      // An edit during a slow save stays pending. Never chain an immediate save.
      if (revision !== this.revision && !this.idle && this.hasChanges()) this.schedule();
    }
  }

  close(): void { this.closed = true; clearTimeout(this.idle); }
}
