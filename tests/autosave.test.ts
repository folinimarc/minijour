import { afterEach, expect, it, vi } from 'vitest';
import { Autosave } from '../src/storage/autosave';

let autosave: Autosave | undefined;
afterEach(() => { autosave?.close(); vi.useRealTimers(); });

it('saves once after a pause, and does no work when nothing changed', async () => {
  vi.useFakeTimers();
  let dirty = true;
  const save = vi.fn(async () => { dirty = false; });
  autosave = new Autosave(save, () => dirty, vi.fn());
  autosave.changed();
  await vi.advanceTimersByTimeAsync(1000);
  autosave.changed();
  await vi.advanceTimersByTimeAsync(1499);
  expect(save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(save).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(save).toHaveBeenCalledTimes(1);
});

it('checkpoints continuous typing every ten seconds without redundant idle saves', async () => {
  vi.useFakeTimers();
  let dirty = false;
  const save = vi.fn(async () => { dirty = false; });
  autosave = new Autosave(save, () => dirty, vi.fn());
  for (let step = 0; step < 40; step++) {
    dirty = true; autosave.changed();
    await vi.advanceTimersByTimeAsync(500);
  }
  expect(save).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1500);
  expect(save).toHaveBeenCalledTimes(2);
});

it('skips a periodic checkpoint if a save succeeded in the preceding interval', async () => {
  vi.useFakeTimers();
  let dirty = true;
  const save = vi.fn(async () => { dirty = false; });
  autosave = new Autosave(save, () => dirty, vi.fn());
  autosave.changed();
  await vi.advanceTimersByTimeAsync(1500);
  for (let step = 0; step < 17; step++) {
    dirty = true; autosave.changed();
    await vi.advanceTimersByTimeAsync(500);
  }
  expect(save).toHaveBeenCalledTimes(1);
  for (let step = 0; step < 20; step++) {
    dirty = true; autosave.changed();
    await vi.advanceTimersByTimeAsync(500);
  }
  expect(save).toHaveBeenCalledTimes(2);
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
  autosave.changed();
  await vi.advanceTimersByTimeAsync(1500);
  autosave.changed();
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
  autosave.changed();
  await vi.advanceTimersByTimeAsync(1500);
  expect(notify).toHaveBeenCalledWith(error);
  await vi.advanceTimersByTimeAsync(8500);
  expect(save).toHaveBeenCalledTimes(2);
});
