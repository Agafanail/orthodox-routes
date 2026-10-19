const MAX_RESPONSE_BYTES = 16_384;

export async function readBoundedProviderAcknowledgement(response: Response, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw new Error('Oversized provider acknowledgement.');
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  let complete = false;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      if (signal.aborted) throw new Error('Provider acknowledgement deadline exceeded.');
      const part = await reader.read();
      if (part.done) { complete = true; break; }
      if (!(part.value instanceof Uint8Array)) throw new Error('Invalid provider acknowledgement stream.');
      if (part.value.byteLength === 0) continue;
      size += part.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Oversized provider acknowledgement.');
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    // JSON/stream exceptions may embed provider-controlled input; never forward their message or cause.
    throw new Error('Provider acknowledgement unavailable.');
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!complete) cancel();
    reader.releaseLock();
  }
}
