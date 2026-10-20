// Shared byte/UTF-8/JSON boundary; callers retain their protocol/header/error policy.
export async function readLimitedJson(source: Pick<Response, 'body'>, signal: AbortSignal,
  maxBytes: number, deadlineMs?: number): Promise<unknown> {
  let available: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try { available = source.body?.getReader(); } catch { throw new Error('JSON body unavailable.'); }
  const reader = available;
  if (!reader) return null;
  let complete = false, cancelled = false, interrupted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectStopped: (reason: Error) => void = () => {};
  const stopped = new Promise<never>((_, reject) => { rejectStopped = reject; });
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    try { void reader.cancel().catch(() => {}); } catch { /* Cancellation is best effort. */ }
  };
  const interrupt = () => { interrupted = true; rejectStopped(new Error('JSON body unavailable.')); cancel(); };
  signal.addEventListener('abort', interrupt, { once: true });
  try {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1_048_576
      || (deadlineMs !== undefined && (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 2_147_483_647))
      || signal.aborted) throw new Error('JSON body unavailable.');
    if (deadlineMs !== undefined) timer = setTimeout(interrupt, deadlineMs);
    const chunks: Uint8Array[] = [];
    let size = 0, parts = 0;
    while (true) {
      // Bound empty-chunk microtask loops as well as actual bytes, so timers can run.
      if (++parts > maxBytes + 1024 || signal.aborted) throw new Error('JSON body unavailable.');
      const part = await Promise.race([reader.read(), stopped]);
      if (interrupted || signal.aborted) throw new Error('JSON body unavailable.');
      if (part.done) { complete = true; break; }
      if (!(part.value instanceof Uint8Array)) throw new Error('JSON body unavailable.');
      if (part.value.byteLength === 0) continue;
      size += part.value.byteLength;
      if (size > maxBytes) throw new Error('JSON body unavailable.');
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    // Never reflect stream/parser messages: either source may contain private input.
    throw new Error('JSON body unavailable.');
  } finally {
    signal.removeEventListener('abort', interrupt); clearTimeout(timer);
    if (!complete) cancel();
    try { reader.releaseLock(); } catch { /* An abandoned read must not prevent return. */ }
  }
}
