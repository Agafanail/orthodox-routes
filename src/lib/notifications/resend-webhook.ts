import { Webhook } from 'svix';

type RpcResult = { data: unknown; error: unknown };

export type ResendWebhookClient = {
  schema(name: 'api'): {
    rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
  };
};

type WebhookHeaders = { id: string; signature: string; timestamp: string };

const EVENT_TYPE = /^email\.(?:sent|delivered|delivery_delayed|failed|bounced|complained|suppressed|opened|clicked)$/;
const EVENT_ID = /^[A-Za-z0-9_-]{8,200}$/;
const EMAIL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readResendWebhookHeaders(headers: Headers): WebhookHeaders | null {
  const id = headers.get('svix-id');
  const signature = headers.get('svix-signature');
  const timestamp = headers.get('svix-timestamp');
  return id && signature && timestamp && EVENT_ID.test(id) ? { id, signature, timestamp } : null;
}

export async function processResendWebhook(
  rawBody: string,
  headers: WebhookHeaders,
  secret: string,
  client: ResendWebhookClient,
) {
  try {
    new Webhook(secret).verify(rawBody, {
      'svix-id': headers.id,
      'svix-signature': headers.signature,
      'svix-timestamp': headers.timestamp,
    });
  } catch {
    return { accepted: false, reason: 'invalid_signature' as const };
  }
  let verified: unknown;
  try {
    verified = JSON.parse(rawBody) as unknown;
  } catch {
    return { accepted: false, reason: 'invalid_payload' as const };
  }
  if (!verified || typeof verified !== 'object' || Array.isArray(verified)) {
    return { accepted: false, reason: 'invalid_payload' as const };
  }
  const event = verified as Record<string, unknown>;
  const data = event.data;
  const providerReference = data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>).email_id
    : null;
  const occurredAt = typeof event.created_at === 'string' ? event.created_at : '';
  if (
    typeof event.type !== 'string' || !EVENT_TYPE.test(event.type)
    || typeof providerReference !== 'string' || !EMAIL_ID.test(providerReference)
    || !Number.isFinite(Date.parse(occurredAt))
  ) return { accepted: false, reason: 'invalid_payload' as const };

  const result = await client.schema('api').rpc('notification_worker_record_provider_event', {
    p_event_id: headers.id,
    p_event_type: event.type,
    p_occurred_at: occurredAt,
    p_provider: 'resend',
    p_provider_reference: providerReference,
  });
  return result.error
    ? { accepted: false, reason: 'database_unavailable' as const }
    : { accepted: true, result: result.data };
}
