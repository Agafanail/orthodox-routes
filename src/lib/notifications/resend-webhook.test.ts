import { Webhook } from 'svix';
import { describe, expect, it, vi } from 'vitest';
import { processResendWebhook, type ResendWebhookClient } from './resend-webhook';

const secret = `whsec_${Buffer.from('orthodox-routes-webhook-secret').toString('base64')}`;

function signedPayload(payload: string) {
  const id = 'msg_notification_webhook_001';
  const now = new Date();
  return {
    headers: { id, signature: new Webhook(secret).sign(id, now, payload), timestamp: `${Math.floor(now.getTime() / 1000)}` },
    payload,
  };
}

describe('Resend notification webhook', () => {
  it('verifies the raw payload and forwards only minimized delivery metadata', async () => {
    const event = signedPayload(JSON.stringify({
      created_at: new Date().toISOString(),
      data: { email_id: '019c7134-a39b-7d8e-a4ad-8b11d56d0099', subject: 'private provider copy' },
      type: 'email.delivered',
    }));
    const rpc = vi.fn(async () => ({ data: { matched: true }, error: null }));
    const client = { schema: vi.fn(() => ({ rpc })) } as ResendWebhookClient;
    await expect(processResendWebhook(event.payload, event.headers, secret, client)).resolves.toEqual({
      accepted: true, result: { matched: true },
    });
    expect(rpc).toHaveBeenCalledWith('notification_worker_record_provider_event', {
      p_event_id: event.headers.id,
      p_event_type: 'email.delivered',
      p_occurred_at: expect.any(String),
      p_provider: 'resend',
      p_provider_reference: '019c7134-a39b-7d8e-a4ad-8b11d56d0099',
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('private provider copy');
  });

  it('rejects a changed payload before database access', async () => {
    const event = signedPayload(JSON.stringify({
      created_at: new Date().toISOString(), data: { email_id: '019c7134-a39b-7d8e-a4ad-8b11d56d0099' },
      type: 'email.sent',
    }));
    const rpc = vi.fn();
    const client = { schema: vi.fn(() => ({ rpc })) } as ResendWebhookClient;
    await expect(processResendWebhook(`${event.payload} `, event.headers, secret, client)).resolves.toEqual({
      accepted: false, reason: 'invalid_signature',
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
