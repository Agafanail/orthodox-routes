import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLimitedJson } from './limited-json';

describe('shared limited JSON byte reader', () => {
  afterEach(() => vi.useRealTimers());
  it('bounds empty-chunk loops without waiting for event-loop timers', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array()); }, cancel });
    await expect(readLimitedJson(new Response(stream), new AbortController().signal, 16)).rejects.toThrow('JSON body unavailable.');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('interrupts an abort-ignoring reader even without an enclosing provider timeout', async () => {
    vi.useFakeTimers(); const controller = new AbortController(), cancel = vi.fn(() => new Promise<never>(() => {}));
    const pending = readLimitedJson(new Response(new ReadableStream({ cancel })), controller.signal, 16);
    const assertion = expect(pending).rejects.toThrow('JSON body unavailable.');
    controller.abort(); await assertion; expect(cancel).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('contains failures before reader acquisition without cancelling another consumer', async () => {
    const cancel = vi.fn(), response = new Response(new ReadableStream({ cancel }));
    const owner = response.body!.getReader();
    try {
      await expect(readLimitedJson(response, new AbortController().signal, 16)).rejects.toThrow('JSON body unavailable.');
      expect(cancel).not.toHaveBeenCalled();
    } finally { owner.releaseLock(); }
    await expect(readLimitedJson({ get body(): Response['body'] { throw new Error('private@example.test'); } }, new AbortController().signal, 16))
      .rejects.toThrow('JSON body unavailable.');
  });
  it.each([0, -1, 1.5, Infinity, 2_147_483_648])('rejects invalid platform timer values %s without leaving timers', async (deadline) => {
    vi.useFakeTimers(); const cancel = vi.fn();
    await expect(readLimitedJson(new Response(new ReadableStream({ cancel })), new AbortController().signal, 16, deadline))
      .rejects.toThrow('JSON body unavailable.');
    expect(cancel).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
});
