import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComplaintPreparationRequestReader } from './request';
import { createComplaintPreparationBroker, createComplaintPreparationIntent } from './preparation';

const appOrigin = 'https://routes.example.test';
const payload = { targetType: 'church', targetId: '019c7134-a39b-7d8e-a4ad-8b11d56d0011', category: 'other',
  description: 'Synthetic report', replyEmail: 'reporter@example.test', language: 'en', challengeToken: 'synthetic' };
function request(body: BodyInit | null = '{"description":"synthetic"}', headers: Partial<Record<string, string>> = {}, signal?: AbortSignal) {
  return new Request(`${appOrigin}/inactive-report`, { method: 'POST', body, signal,
    headers: { origin: appOrigin, 'content-type': 'application/json', ...headers }, duplex: 'half' } as RequestInit);
}
describe('inactive complaint HTTP intake', () => {
  afterEach(() => vi.useRealTimers());
  it('parses only an untrusted object without inventing actor/proxy/verdict authority', async () => {
    const input = { targetType: 'church', description: 'Synthetic report', challengeToken: 'synthetic' };
    const result = await createComplaintPreparationRequestReader(appOrigin)(request(JSON.stringify(input)));
    expect(result).toEqual({ status: 'parsed', input });
    expect(result).not.toHaveProperty('received'); expect(result).not.toHaveProperty('reporterAccountId');
    // Domain/authority-field validation still belongs to the existing broker, not this reader.
    expect(await createComplaintPreparationRequestReader(appOrigin)(request('{"reporterAccountId":"untrusted"}')))
      .toEqual({ status: 'parsed', input: { reporterAccountId: 'untrusted' } });
  });
  it.each([null, undefined, '', 'http://routes.example.test', 'https://person:secret@routes.example.test',
    'https://routes.example.test/path', `${appOrigin}/?private`, `${appOrigin}/#private`])
  ('fails closed without a valid trusted public HTTPS origin %#', async (value) => {
    expect(await createComplaintPreparationRequestReader(value)(request())).toEqual({ status: 'unavailable' });
  });
  it.each([{ origin: 'https://foreign.example.test' }, { origin: 'null' }, { origin: `${appOrigin}/` },
    { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }, { 'sec-fetch-site': 'none' },
    { 'content-type': 'text/plain' }, { 'content-type': 'application/json; charset=iso-8859-1' },
    { 'content-encoding': 'gzip' }, { 'content-length': '65537' }, { 'content-length': '-1' }, { 'content-length': 'invalid' }])
  ('refuses unsafe metadata before reading any body %#', async (headers) => {
    const cancel = vi.fn(), req = request(new ReadableStream({ cancel }), headers);
    expect(await createComplaintPreparationRequestReader(appOrigin)(req)).toEqual({ status: 'invalid_request' });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('requires explicit origin and POST rather than trusting forwarded host headers', async () => {
    const missing = request('{}', { 'x-forwarded-host': 'routes.example.test', 'x-forwarded-proto': 'https' });
    missing.headers.delete('origin');
    expect(await createComplaintPreparationRequestReader(appOrigin)(missing)).toEqual({ status: 'invalid_request' });
    expect(await createComplaintPreparationRequestReader(appOrigin)(new Request(appOrigin, { headers: { origin: appOrigin } })))
      .toEqual({ status: 'invalid_request' });
  });
  it.each(['application/json; charset=UTF-8', 'application/json; charset="utf-8"'])('accepts UTF-8 metadata %s', async (type) => {
    expect(await createComplaintPreparationRequestReader(`${appOrigin}/`)(request('{"text":"😀é"}', { 'content-type': type })))
      .toEqual({ status: 'parsed', input: { text: '😀é' } });
  });
  it.each(['private@example.test malformed', 'null', '[]', 'true', '1', '"private@example.test"'])
  ('contains invalid JSON/non-object body %#', async (body) => {
    expect(await createComplaintPreparationRequestReader(appOrigin)(request(body))).toEqual({ status: 'invalid_request' });
  });
  it('bounds actual bytes even with missing/false length and preserves split Unicode', async () => {
    const raw = new TextEncoder().encode('{"text":"😀é"}');
    const split = new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of raw) controller.enqueue(new Uint8Array([byte])); controller.close();
    } });
    expect(await createComplaintPreparationRequestReader(appOrigin)(request(split)))
      .toEqual({ status: 'parsed', input: { text: '😀é' } });
    const cancel = vi.fn();
    const oversized = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(32768)); controller.enqueue(new Uint8Array(32769));
    }, cancel });
    expect(await createComplaintPreparationRequestReader(appOrigin)(request(oversized, { 'content-length': '1' })))
      .toEqual({ status: 'invalid_request' }); expect(cancel).toHaveBeenCalledOnce();
    const exact = JSON.stringify({ text: 'x'.repeat(65_525) });
    expect(new TextEncoder().encode(exact).length).toBe(65_536);
    expect((await createComplaintPreparationRequestReader(appOrigin)(request(exact))).status).toBe('parsed');
  });
  it('contains malformed UTF-8 and non-byte stream chunks', async () => {
    expect(await createComplaintPreparationRequestReader(appOrigin)(request(new Uint8Array([0xff, 0xfe]))))
      .toEqual({ status: 'invalid_request' });
    const bad = new ReadableStream({ start(controller) { controller.enqueue('private@example.test'); } });
    expect(await createComplaintPreparationRequestReader(appOrigin)(request(bad))).toEqual({ status: 'invalid_request' });
  });
  it.each(['timeout', 'abort'])('does not accept a valid prefix when a stalled stream is interrupted by %s', async (stage) => {
    vi.useFakeTimers(); const controller = new AbortController();
    const cancel = vi.fn(() => new Promise<never>(() => {}));
    const body = new ReadableStream<Uint8Array>({ start(stream) { stream.enqueue(new TextEncoder().encode('{}')); }, cancel });
    const pending = createComplaintPreparationRequestReader(appOrigin)(request(body, {}, controller.signal));
    await vi.advanceTimersByTimeAsync(0);
    if (stage === 'abort') controller.abort(); else await vi.advanceTimersByTimeAsync(5001);
    expect(await pending).toEqual({ status: 'invalid_request' });
    expect(cancel).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('refuses consumed and already aborted bodies', async () => {
    const consumed = request(); await consumed.text();
    expect(await createComplaintPreparationRequestReader(appOrigin)(consumed)).toEqual({ status: 'invalid_request' });
    const controller = new AbortController(); controller.abort();
    expect(await createComplaintPreparationRequestReader(appOrigin)(request('{}', {}, controller.signal)))
      .toEqual({ status: 'invalid_request' });
  });
  it('retains the existing broker as the domain/authority boundary after parsing', async () => {
    const read = createComplaintPreparationRequestReader(appOrigin);
    const rpc = vi.fn((name: string) => ({ abortSignal: () => Promise.resolve({ error: null,
      data: name === 'consume_complaint_rate_limit' ? 'allowed' : { draft_id: payload.targetId,
        status: 'pending_email', expires_at: new Date(Date.now() + 60_000).toISOString() } }) }));
    const verifyChallenge = vi.fn(async () => 'verified' as const);
    const broker = createComplaintPreparationBroker({ client: { schema: () => ({ rpc }) }, verifyChallenge,
      rateSecret: 'synthetic-independent-rate-secret-at-least-32-chars' });
    const parsed = await read(request(JSON.stringify(payload)));
    if (parsed.status !== 'parsed') throw new Error('Synthetic request was refused.');
    const trusted = { reporterAccountId: null, trustedNetworkAddress: '192.0.2.21' };
    expect((await broker(parsed.input, trusted, createComplaintPreparationIntent())).status).toBe('pending_email');
    expect(rpc).toHaveBeenCalledTimes(2); expect(verifyChallenge).toHaveBeenCalledTimes(1);
    const forged = await read(request(JSON.stringify({ ...payload, reporterAccountId: payload.targetId })));
    if (forged.status !== 'parsed') throw new Error('Synthetic JSON parse failed.');
    expect(await broker(forged.input, trusted, createComplaintPreparationIntent())).toEqual({ status: 'unavailable' });
    expect(rpc).toHaveBeenCalledTimes(2); expect(verifyChallenge).toHaveBeenCalledTimes(1);
  });
  it('covers existing field maxima even when JSON strings use escaped Unicode', async () => {
    const maximum = { ...payload, description: '😀'.repeat(4000),
      replyEmail: ' '.repeat(258) + 'a'.repeat(241) + '@example.test', challengeToken: 'a'.repeat(2048) };
    expect(maximum.replyEmail.length).toBe(512);
    const quoted = (value: string) => '"' + value.split('').map((char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).join('') + '"';
    const escaped = '{' + Object.entries(maximum).map(([key, value]) => `${quoted(key)}:${quoted(value)}`).join(',') + '}';
    expect(new TextEncoder().encode(escaped).length).toBeGreaterThan(48_000);
    expect(new TextEncoder().encode(escaped).length).toBeLessThan(65_536);
    expect(await createComplaintPreparationRequestReader(appOrigin)(request(escaped))).toEqual({ status: 'parsed', input: maximum });
  });
  it('contains private stream errors without returning diagnostics', async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('private@example.test')); } });
    expect(await createComplaintPreparationRequestReader(appOrigin)(request(body))).toEqual({ status: 'invalid_request' });
  });
});
