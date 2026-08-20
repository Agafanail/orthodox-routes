import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  attachContextualRegistrationEmail,
  buildAuthConfirmationUrl,
  claimContextualRegistrationDraft,
  createContextualRegistrationDraft,
  parseContextualPayload,
} from './flow';
import { openContextualResume, sealContextualResume } from './secure-token';

const config = {
  appOrigin: 'https://routes.example.org',
  secret: 'contextual-test-secret-that-is-long-enough',
};

function rpcClient(result: unknown) {
  const rpc = vi.fn().mockResolvedValue(result);
  return {
    client: { schema: vi.fn(() => ({ rpc })) } as unknown as Pick<SupabaseClient, 'schema'>,
    rpc,
  };
}

describe('contextual registration application boundary', () => {
  it('rejects contact-bearing or non-JSON action payloads before the database call', async () => {
    expect(parseContextualPayload({ email: 'person@example.org' })).toBeNull();
    expect(parseContextualPayload({ nested: { phoneNumber: '+390000000000' } })).toBeNull();
    expect(parseContextualPayload([])).toBeNull();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(parseContextualPayload(circular)).toBeNull();

    const { client, rpc } = rpcClient({ data: null, error: null });
    await expect(createContextualRegistrationDraft(client, config, {
      actionType: 'passenger_request',
      payload: { contact: 'forbidden' },
    }, 'a'.repeat(64))).resolves.toEqual({ status: 'invalid' });
    await expect(createContextualRegistrationDraft(client, config, {
      actionType: 'passenger_request',
      clientKey: 'browser-controlled-but-malformed',
      payload: { churchId: 'church-1' },
    }, 'a'.repeat(64))).resolves.toEqual({ status: 'invalid' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('creates a server-owned draft and returns only a sealed resume ticket', async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const { client, rpc } = rpcClient({
      data: { draft_id: '9b11b924-53fa-4b86-8194-d960f8f9db89', expires_at: expiresAt, status: 'open' },
      error: null,
    });
    const clientKey = '4ab18dce-5b95-4bc8-a4fa-23f38c4c3952';
    const result = await createContextualRegistrationDraft(client, config, {
      actionType: 'passenger_request',
      clientKey,
      payload: { churchId: 'church-1', passengerCount: 2 },
      registrationProfile: {
        displayName: '  Anna Parishioner  ',
        phone: '+39 000 000 0299',
        preferredLanguage: 'en',
      },
    }, 'a'.repeat(64));

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Expected a ready contextual draft.');
    const rpcInput = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(rpcInput.p_resume_token).toMatch(/^[0-9a-f]{64}$/);
    expect(rpcInput).toMatchObject({
      p_client_key: clientKey,
      p_display_name: 'Anna Parishioner',
      p_phone_e164: '+390000000299',
      p_preferred_language: 'en',
    });
    expect(result.ticket).not.toContain(String(rpcInput.p_resume_token));
    expect(openContextualResume(result.ticket, config.secret)?.capability).toBe(rpcInput.p_resume_token);
    expect(result).not.toHaveProperty('payload');
  });

  it('binds the verified-email intent and builds a fixed-origin confirmation URL', async () => {
    const capability = 'a'.repeat(64);
    const ticket = sealContextualResume({
      capability,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }, config.secret);
    const { client, rpc } = rpcClient({
      data: { draft_id: '9b11b924-53fa-4b86-8194-d960f8f9db89', status: 'attached' },
      error: null,
    });
    const result = await attachContextualRegistrationEmail(
      client,
      config,
      ticket,
      ' Person@Example.org ',
      'b'.repeat(64),
    );

    expect(result.status).toBe('attached');
    if (result.status !== 'attached') throw new Error('Expected an attached contextual email.');
    const destination = new URL(result.emailRedirectTo);
    expect(destination.origin).toBe(config.appOrigin);
    expect(destination.pathname).toBe('/auth/confirm');
    expect(destination.search).toBe('');
    const fragment = new URLSearchParams(destination.hash.slice(1));
    expect(fragment.get('flow')).toBe('contextual');
    expect(fragment.get('draft')).toBe(ticket);
    expect(result.emailRedirectTo).not.toContain(capability);
    expect(rpc).toHaveBeenCalledWith('attach_contextual_draft_email', {
      p_email: 'Person@Example.org',
      p_rate_key: 'b'.repeat(64),
      p_resume_token: capability,
    });
  });

  it('claims only a valid sealed ticket and accepts only a claimed safe payload shape', async () => {
    const capability = 'c'.repeat(64);
    const ticket = sealContextualResume({
      capability,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }, config.secret);
    const draft = {
      action_type: 'driver_offer',
      created_at: '2026-08-15T12:00:00.000Z',
      draft_id: '9b11b924-53fa-4b86-8194-d960f8f9db89',
      eligibility: { eligible: false },
      expires_at: '2026-08-16T12:00:00.000Z',
      payload: { churchId: 'church-1', seatsAvailable: 3 },
      payload_version: 1,
      status: 'claimed',
    };
    const { client, rpc } = rpcClient({ data: draft, error: null });

    await expect(claimContextualRegistrationDraft(client, config, ticket)).resolves.toEqual(draft);
    expect(rpc).toHaveBeenCalledWith('claim_contextual_draft', { p_resume_token: capability });
    await expect(claimContextualRegistrationDraft(client, config, 'invalid')).resolves.toBeNull();
    expect(buildAuthConfirmationUrl(config)).toBe(
      'https://routes.example.org/auth/confirm#flow=login',
    );
  });
});
