import { describe, expect, it, vi } from 'vitest';
import { readBoundedProviderAcknowledgement } from './acknowledgement';

describe('bounded provider acknowledgement reader', () => {
  it('reads split UTF-8 bytes without reflecting private parser failures', async () => {
    const encoded = new TextEncoder().encode('{"id":"é"}');
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of encoded) controller.enqueue(new Uint8Array([byte])); controller.close();
    } });
    expect(await readBoundedProviderAcknowledgement(new Response(body), new AbortController().signal)).toEqual({ id: 'é' });
    await expect(readBoundedProviderAcknowledgement(new Response('private@example.test malformed'), new AbortController().signal))
      .rejects.toThrow('Provider acknowledgement unavailable.');
  });
  it('refuses a non-byte stream immediately and cancels it', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ start(controller) { controller.enqueue('synthetic-private-body'); }, cancel });
    await expect(readBoundedProviderAcknowledgement(new Response(body), new AbortController().signal))
      .rejects.toThrow('Provider acknowledgement unavailable.');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('bounds cumulative stream bytes, not only an advertised size', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(8192)); controller.enqueue(new Uint8Array(8193));
    }, cancel });
    await expect(readBoundedProviderAcknowledgement(new Response(body), new AbortController().signal))
      .rejects.toThrow('Provider acknowledgement unavailable.');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('cancels a body when the supplied deadline already expired', async () => {
    const cancel = vi.fn(); const deadline = new AbortController(); deadline.abort();
    await expect(readBoundedProviderAcknowledgement(new Response(new ReadableStream({ cancel })), deadline.signal))
      .rejects.toThrow('Provider acknowledgement unavailable.');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('does not interpret an absent body as an acknowledgement', async () => {
    expect(await readBoundedProviderAcknowledgement(new Response(null), new AbortController().signal)).toBeNull();
  });
});
