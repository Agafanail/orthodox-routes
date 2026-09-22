import { describe, expect, it, vi } from 'vitest';
import type { ResendNotificationConfig } from '@/lib/supabase/config';
import type { NotificationDeliveryJob, NotificationMessage } from './adapter';
import { createResendNotificationAdapter } from './resend';

const config: ResendNotificationConfig = {
  apiKey: `re_${'a'.repeat(32)}`,
  appOrigin: 'https://routes.example.org',
  from: 'Orthodox Routes <notify@example.org>',
};
const job = {
  channel: 'email', destinationValue: 'person@example.org',
  jobId: '019c7134-a39b-7d8e-a4ad-8b11d56d0011',
} as NotificationDeliveryJob;
const message = {
  email: { html: '<p>Update</p>', subject: 'Update', text: 'Update' }, push: '{}',
} satisfies NotificationMessage;

describe('Resend notification adapter', () => {
  it('sends safe content with a durable idempotency key', async () => {
    const providerFetch = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ id: '019c7134-a39b-7d8e-a4ad-8b11d56d0099' }),
      { status: 200 },
    ));
    await expect(createResendNotificationAdapter(config, providerFetch).send(job, message)).resolves.toEqual({
      outcome: 'sent', providerAdapter: 'resend-email-v1', providerCode: 'http_200',
      providerReference: '019c7134-a39b-7d8e-a4ad-8b11d56d0099', safeFailureClass: null,
    });
    const [, init] = providerFetch.mock.calls[0];
    expect(init?.headers).toMatchObject({
      authorization: `Bearer ${config.apiKey}`,
      'idempotency-key': `notification-${job.jobId}`,
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      from: config.from, html: message.email.html, subject: message.email.subject,
      text: message.email.text, to: [job.destinationValue],
    });
  });

  it('classifies retryable and permanent responses without leaking provider bodies', async () => {
    const rateLimited = vi.fn<typeof fetch>(async () => new Response('secret provider body', { status: 429 }));
    const rejected = vi.fn<typeof fetch>(async () => new Response('secret provider body', { status: 422 }));
    await expect(createResendNotificationAdapter(config, rateLimited).send(job, message)).resolves.toMatchObject({
      outcome: 'temporary_failure', providerCode: 'http_429', providerReference: null,
      safeFailureClass: 'provider_rate_limited',
    });
    await expect(createResendNotificationAdapter(config, rejected).send(job, message)).resolves.toMatchObject({
      outcome: 'permanent_failure', providerCode: 'http_422', providerReference: null,
      safeFailureClass: 'provider_rejected',
    });
  });
});
