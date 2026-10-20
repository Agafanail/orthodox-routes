import { readLimitedJson } from '@/lib/http/limited-json';

const MAX_BODY_BYTES = 65_536; // Covers existing field maxima, including escaped Unicode.
type Result = { status: 'unavailable' | 'invalid_request' } | { status: 'parsed'; input: Record<string, unknown> };

function origin(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash
      ? url.origin : null;
  } catch { return null; }
}

// Inactive server intake only. Parsed input remains UNTRUSTED and must pass the existing
// broker plus verified session/proxy/cookie boundaries; never return it as a browser receipt.
export function createComplaintPreparationRequestReader(applicationOrigin: unknown) {
  const expectedOrigin = origin(applicationOrigin);
  return async (request: Request): Promise<Result> => {
    let consumed = false;
    try {
      if (!expectedOrigin) return { status: 'unavailable' };
      const type = request.headers.get('content-type')?.trim().toLowerCase() ?? '';
      const length = request.headers.get('content-length');
      const site = request.headers.get('sec-fetch-site');
      const encoding = request.headers.get('content-encoding');
      if (request.method !== 'POST' || request.headers.get('origin') !== expectedOrigin
        || (site !== null && site !== 'same-origin')
        || !/^application\/json(?:\s*;\s*charset=(?:utf-8|"utf-8"))?$/.test(type)
        || (encoding !== null && encoding.toLowerCase() !== 'identity')
        || (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES))
        || request.bodyUsed || request.signal.aborted) return { status: 'invalid_request' };
      consumed = true;
      const input = await readLimitedJson(request, request.signal, MAX_BODY_BYTES, 5000);
      return input && typeof input === 'object' && !Array.isArray(input)
        ? { status: 'parsed', input: input as Record<string, unknown> } : { status: 'invalid_request' };
    } catch { return { status: 'invalid_request' }; }
    finally {
      if (!consumed) {
        try { void request.body?.cancel().catch(() => {}); } catch { /* Do not await rejected/stalled input. */ }
      }
    }
  };
}
