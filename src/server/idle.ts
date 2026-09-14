/**
 * When the backend ends by itself.
 *
 * Only when nobody needs it: no wrapper and no module connected, for the
 * whole grace period. The previous generation counted wrappers only, so a
 * backend ended under a connected module, and the next Claude session had to
 * wait for the module to find the new one. The grace period exists because a
 * restarting session drops its old connection shortly before the new one
 * arrives.
 */
export class IdleShutdown {
  private timer: NodeJS.Timeout | null = null;
  private wrappers = 0;
  private modules = 0;

  constructor(
    private readonly graceMs: number,
    private readonly onIdle: () => void
  ) {}

  /** Call once at startup and whenever a count changes. */
  update(counts: { wrappers?: number; modules?: number }): void {
    if (counts.wrappers !== undefined) this.wrappers = counts.wrappers;
    if (counts.modules !== undefined) this.modules = counts.modules;

    if (this.wrappers > 0 || this.modules > 0) {
      this.cancel();
      return;
    }
    if (this.timer || this.graceMs <= 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.wrappers === 0 && this.modules === 0) this.onIdle();
    }, this.graceMs);
    this.timer.unref?.();
  }

  get pending(): boolean {
    return this.timer !== null;
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
