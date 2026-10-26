/** Both automatic timers require a pause; the interval only retries missed saves. */
export class Autosave {
  private idle?: ReturnType<typeof setTimeout>;
  private interval: ReturnType<typeof setInterval>;
  private running = false;
  private revision = 0;
  private lastSave = performance.now();
  private lastEdit = -Infinity;

  constructor(
    private save: () => Promise<void>,
    private hasChanges: () => boolean,
    private onError: (error: unknown) => void,
  ) {
    this.interval = setInterval(() => {
      if (performance.now() - this.lastSave >= 10_000) void this.checkpoint();
    }, 10_000);
  }

  changed(): void {
    this.revision++;
    this.schedule();
  }

  edited(): void {
    this.lastEdit = performance.now();
    this.changed();
  }

  get isIdle(): boolean { return performance.now() - this.lastEdit >= 1500; }

  /** Explicit saves count too, so the fallback does not repeat recent work. */
  saved(): void { this.lastSave = performance.now(); }

  private schedule(): void {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      this.idle = undefined;
      void this.checkpoint();
    }, 1500);
  }

  private async checkpoint(): Promise<void> {
    if (this.running || !this.isIdle || !this.hasChanges()) return;
    this.running = true;
    const revision = this.revision;
    try {
      await this.save();
      this.saved();
    } catch (error) { this.onError(error); }
    finally {
      this.running = false;
      // An edit during a slow save stays pending. Never chain an immediate save.
      if (revision !== this.revision && !this.idle && this.hasChanges()) this.schedule();
    }
  }

  close(): void { clearTimeout(this.idle); clearInterval(this.interval); }
}
