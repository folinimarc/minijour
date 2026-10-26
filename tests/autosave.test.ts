import { afterEach, expect, it, vi } from 'vitest';
import { Autosave } from '../src/storage/autosave';

let autosave: Autosave | undefined;
afterEach(() => { autosave?.close(); vi.useRealTimers(); });

it('saves once after a pause, and does no work when nothing changed', async () => {
  vi.useFakeTimers();
  let dirty = true;
  const save = vi.fn(async () => { dirty = false; });
  autosave = new Autosave(save, () => dirty, vi.fn());
  autosave.edited();
  await vi.advanceTimersByTimeAsync(1000);
  autosave.edited();
  await vi.advanceTimersByTimeAsync(1499);
  expect(save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(save).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(save).toHaveBeenCalledTimes(1);
});

it('never starts an automatic save during continuous typing, including periodic checkpoints', async () => {
  vi.useFakeTimers();
  let dirty = false;
  const save = vi.fn(async () => { dirty = false; });
  autosave = new Autosave(save, () => dirty, vi.fn());
  for (let step = 0; step < 40; step++) {
    dirty = true; autosave.edited();
    await vi.advanceTimersByTimeAsync(500);
  }
  expect(save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(999);
  expect(save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(save).toHaveBeenCalledTimes(1);
});

it('checks the latest edit when typing resumes just before a periodic tick', async () => {
  vi.useFakeTimers();
  let dirty = true;
  const save = vi.fn(async () => { dirty = false; });
  autosave = new Autosave(save, () => dirty, vi.fn());
  await vi.advanceTimersByTimeAsync(9999);
  autosave.edited();
  await vi.advanceTimersByTimeAsync(1);
  expect(save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1498);
  expect(save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(save).toHaveBeenCalledTimes(1);
});

it('keeps edits during a slow save pending and waits for another pause', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  let dirty = true;
  const save = vi.fn(async () => {
    if (save.mock.calls.length === 1) await new Promise<void>(resolve => { finish = resolve; });
    else dirty = false;
  });
  autosave = new Autosave(save, () => dirty, vi.fn());
  autosave.edited();
  await vi.advanceTimersByTimeAsync(1500);
  autosave.edited();
  await vi.advanceTimersByTimeAsync(1500);
  expect(save).toHaveBeenCalledTimes(1);
  finish(); await vi.advanceTimersByTimeAsync(0);
  expect(save).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1499);
  expect(save).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(save).toHaveBeenCalledTimes(2);
});

it('counts explicit saves when deciding whether the periodic fallback is needed', async () => {
  vi.useFakeTimers();
  const save = vi.fn(async () => {});
  autosave = new Autosave(save, () => true, vi.fn());
  await vi.advanceTimersByTimeAsync(5000);
  autosave.saved();
  await vi.advanceTimersByTimeAsync(5000);
  expect(save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(save).toHaveBeenCalledTimes(1);
});

it('retries a failed save at the periodic checkpoint without requiring another edit', async () => {
  vi.useFakeTimers();
  let dirty = true;
  const error = new Error('Storage unavailable');
  const save = vi.fn().mockRejectedValueOnce(error).mockImplementation(async () => { dirty = false; });
  const notify = vi.fn();
  autosave = new Autosave(save, () => dirty, notify);
  autosave.edited();
  await vi.advanceTimersByTimeAsync(1500);
  expect(notify).toHaveBeenCalledWith(error);
  await vi.advanceTimersByTimeAsync(8500);
  expect(save).toHaveBeenCalledTimes(2);
});

it('uses the periodic fallback for idle pending work even without a change notification', async () => {
  vi.useFakeTimers();
  let dirty = true;
  const save = vi.fn(async () => { dirty = false; });
  autosave = new Autosave(save, () => dirty, vi.fn());
  await vi.advanceTimersByTimeAsync(10_000);
  expect(save).toHaveBeenCalledTimes(1);
});

it('leaves cloud and other background requests pending while typing continues', async () => {
  vi.useFakeTimers();
  const save = vi.fn(async () => {});
  autosave = new Autosave(save, () => true, vi.fn());
  for (let step = 0; step < 25; step++) {
    autosave.edited();
    await vi.advanceTimersByTimeAsync(500);
    autosave.changed();
    await vi.advanceTimersByTimeAsync(500);
  }
  expect(save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1500);
  expect(save).toHaveBeenCalledTimes(1);
});

it('does not mistake a clock adjustment for a pause in editing', async () => {
  vi.useFakeTimers();
  const save = vi.fn(async () => {});
  autosave = new Autosave(save, () => true, vi.fn());
  await vi.advanceTimersByTimeAsync(9999);
  autosave.edited();
  vi.setSystemTime(new Date('2030-01-01'));
  await vi.advanceTimersByTimeAsync(1);
  expect(save).not.toHaveBeenCalled();
  expect(autosave.isIdle).toBe(false);
  await vi.advanceTimersByTimeAsync(1499);
  expect(save).toHaveBeenCalledTimes(1);
});
