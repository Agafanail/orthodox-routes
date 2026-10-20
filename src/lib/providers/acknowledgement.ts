import { readLimitedJson } from '@/lib/http/limited-json';

const MAX_RESPONSE_BYTES = 16_384;

export async function readBoundedProviderAcknowledgement(response: Response, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw new Error('Oversized provider acknowledgement.');
  }
  try {
    return await readLimitedJson(response, signal, MAX_RESPONSE_BYTES);
  } catch {
    // JSON/stream exceptions may embed provider-controlled input; never forward their message or cause.
    throw new Error('Provider acknowledgement unavailable.');
  }
}
