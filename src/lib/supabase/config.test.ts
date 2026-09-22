import { afterEach, describe, expect, it } from 'vitest';
import {
  getContextualRegistrationConfig,
  getApplicationOrigin,
  getBirdSmsConfig,
  getNotificationWorkerSecret,
  getPublicSupabaseConfig,
  getResendNotificationConfig,
  getResendWebhookSecret,
  getServerSupabaseConfig,
  getWebPushNotificationConfig,
  hasPublicSupabaseConfigurationIntent,
  isSafePublicSupabaseKey,
  isSafeServerSupabaseKey,
} from './config';

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const originalSecretKey = process.env.SUPABASE_SECRET_KEY;
const originalAppUrl = process.env.ORTHODOX_ROUTES_APP_URL;
const originalContextSecret = process.env.CONTEXTUAL_REGISTRATION_SECRET;
const originalBirdApiBaseUrl = process.env.BIRD_API_BASE_URL;
const originalBirdApiKey = process.env.BIRD_API_KEY;
const originalBirdSmsSender = process.env.BIRD_SMS_SENDER;
const notificationVariables = [
  'NOTIFICATION_WORKER_SECRET', 'RESEND_API_KEY', 'RESEND_NOTIFICATION_FROM',
  'RESEND_WEBHOOK_SECRET', 'VAPID_KEY_VERSION', 'VAPID_PRIVATE_KEY',
  'VAPID_PUBLIC_KEY', 'VAPID_SUBJECT',
] as const;
const originalNotificationVariables = Object.fromEntries(
  notificationVariables.map((name) => [name, process.env[name]]),
);

function legacyJwt(role: string) {
  const payload = Buffer.from(JSON.stringify({ role })).toString('base64url');
  return `header.${payload}.signature`;
}

afterEach(() => {
  if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;

  if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalKey;

  if (originalSecretKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY = originalSecretKey;
  if (originalAppUrl === undefined) delete process.env.ORTHODOX_ROUTES_APP_URL;
  else process.env.ORTHODOX_ROUTES_APP_URL = originalAppUrl;
  if (originalContextSecret === undefined) delete process.env.CONTEXTUAL_REGISTRATION_SECRET;
  else process.env.CONTEXTUAL_REGISTRATION_SECRET = originalContextSecret;
  if (originalBirdApiBaseUrl === undefined) delete process.env.BIRD_API_BASE_URL;
  else process.env.BIRD_API_BASE_URL = originalBirdApiBaseUrl;
  if (originalBirdApiKey === undefined) delete process.env.BIRD_API_KEY;
  else process.env.BIRD_API_KEY = originalBirdApiKey;
  if (originalBirdSmsSender === undefined) delete process.env.BIRD_SMS_SENDER;
  else process.env.BIRD_SMS_SENDER = originalBirdSmsSender;
  for (const name of notificationVariables) {
    const value = originalNotificationVariables[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('public Supabase configuration', () => {
  it('accepts publishable and legacy anonymous public keys', () => {
    expect(isSafePublicSupabaseKey('sb_publishable_local')).toBe(true);
    expect(isSafePublicSupabaseKey(legacyJwt('anon'))).toBe(true);
  });

  it('rejects secret and service-role credentials', () => {
    expect(isSafePublicSupabaseKey('sb_secret_never_public')).toBe(false);
    expect(isSafePublicSupabaseKey(legacyJwt('service_role'))).toBe(false);
  });

  it('keeps ordinary builds operational when Auth variables are absent', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    expect(getPublicSupabaseConfig()).toBeNull();
    expect(hasPublicSupabaseConfigurationIntent()).toBe(false);
  });

  it('distinguishes partial configuration from an explicitly unconfigured environment', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://partial.example.test';
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    expect(hasPublicSupabaseConfigurationIntent()).toBe(true);
    expect(getPublicSupabaseConfig()).toBeNull();
  });

  it('returns only a valid public URL and key pair', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_local';

    expect(getPublicSupabaseConfig()).toEqual({
      key: 'sb_publishable_local',
      url: 'http://127.0.0.1:54321',
    });
  });
});

describe('server-only backend configuration', () => {
  it('accepts only modern secret or legacy service-role keys', () => {
    expect(isSafeServerSupabaseKey('sb_secret_server_only')).toBe(true);
    expect(isSafeServerSupabaseKey(legacyJwt('service_role'))).toBe(true);
    expect(isSafeServerSupabaseKey('sb_publishable_local')).toBe(false);
    expect(isSafeServerSupabaseKey(legacyJwt('anon'))).toBe(false);
  });

  it('requires the server credential independently of public Auth configuration', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.SUPABASE_SECRET_KEY = legacyJwt('service_role');
    expect(getServerSupabaseConfig()).toEqual({
      key: process.env.SUPABASE_SECRET_KEY,
      url: 'http://127.0.0.1:54321',
    });

    process.env.SUPABASE_SECRET_KEY = 'sb_publishable_wrong_boundary';
    expect(getServerSupabaseConfig()).toBeNull();
  });

  it('requires an origin-only application URL and a strong contextual secret', () => {
    process.env.ORTHODOX_ROUTES_APP_URL = 'https://routes.example.org';
    process.env.CONTEXTUAL_REGISTRATION_SECRET = 's'.repeat(32);
    expect(getContextualRegistrationConfig()).toEqual({
      appOrigin: 'https://routes.example.org',
      secret: 's'.repeat(32),
    });
    expect(getApplicationOrigin()).toBe('https://routes.example.org');

    process.env.ORTHODOX_ROUTES_APP_URL = 'https://routes.example.org/untrusted/path';
    expect(getApplicationOrigin()).toBeNull();
    expect(getContextualRegistrationConfig()).toBeNull();
    process.env.ORTHODOX_ROUTES_APP_URL = 'https://routes.example.org';
    process.env.CONTEXTUAL_REGISTRATION_SECRET = 'short';
    expect(getContextualRegistrationConfig()).toBeNull();
  });
});

describe('notification provider configuration', () => {
  it('accepts complete server-only Resend, worker, webhook, and VAPID configuration', () => {
    process.env.ORTHODOX_ROUTES_APP_URL = 'https://routes.example.org';
    process.env.RESEND_API_KEY = `re_${'a'.repeat(32)}`;
    process.env.RESEND_NOTIFICATION_FROM = 'Orthodox Routes <notify@example.org>';
    process.env.RESEND_WEBHOOK_SECRET = `whsec_${'a'.repeat(32)}`;
    process.env.NOTIFICATION_WORKER_SECRET = 'worker-secret-'.repeat(4);
    process.env.VAPID_PUBLIC_KEY = 'A'.repeat(87);
    process.env.VAPID_PRIVATE_KEY = 'B'.repeat(43);
    process.env.VAPID_SUBJECT = 'mailto:push@example.org';
    process.env.VAPID_KEY_VERSION = '1';

    expect(getResendNotificationConfig()).toEqual({
      apiKey: process.env.RESEND_API_KEY,
      appOrigin: 'https://routes.example.org',
      from: process.env.RESEND_NOTIFICATION_FROM,
    });
    expect(getResendWebhookSecret()).toBe(process.env.RESEND_WEBHOOK_SECRET);
    expect(getNotificationWorkerSecret()).toBe(process.env.NOTIFICATION_WORKER_SECRET);
    expect(getWebPushNotificationConfig()).toEqual({
      keyVersion: 1,
      privateKey: process.env.VAPID_PRIVATE_KEY,
      publicKey: process.env.VAPID_PUBLIC_KEY,
      subject: 'mailto:push@example.org',
    });
  });

  it('fails closed for partial or unsafe notification provider values', () => {
    process.env.ORTHODOX_ROUTES_APP_URL = 'https://routes.example.org';
    process.env.RESEND_API_KEY = 'invalid';
    process.env.RESEND_NOTIFICATION_FROM = 'notify@example.org\r\nBcc: attacker@example.org';
    process.env.RESEND_WEBHOOK_SECRET = 'short';
    process.env.NOTIFICATION_WORKER_SECRET = 'short';
    process.env.VAPID_PUBLIC_KEY = 'A'.repeat(87);
    process.env.VAPID_PRIVATE_KEY = 'B'.repeat(43);
    process.env.VAPID_SUBJECT = 'https://localhost';
    process.env.VAPID_KEY_VERSION = '0';

    expect(getResendNotificationConfig()).toBeNull();
    expect(getResendWebhookSecret()).toBeNull();
    expect(getNotificationWorkerSecret()).toBeNull();
    expect(getWebPushNotificationConfig()).toBeNull();
  });
});

describe('Bird SMS configuration', () => {
  it('accepts one matching regional key, base URL, and active alphanumeric sender', () => {
    process.env.BIRD_API_BASE_URL = 'https://eu1.platform.bird.com';
    process.env.BIRD_API_KEY = `bk_eu1_${'a'.repeat(32)}`;
    process.env.BIRD_SMS_SENDER = 'OrthoRoutes';

    expect(getBirdSmsConfig()).toEqual({
      apiBaseUrl: 'https://eu1.platform.bird.com',
      apiKey: process.env.BIRD_API_KEY,
      sender: 'OrthoRoutes',
    });
  });

  it('fails closed for absent, mismatched, or unsafe provider configuration', () => {
    delete process.env.BIRD_API_BASE_URL;
    delete process.env.BIRD_API_KEY;
    delete process.env.BIRD_SMS_SENDER;
    expect(getBirdSmsConfig()).toBeNull();

    process.env.BIRD_API_BASE_URL = 'https://us1.platform.bird.com';
    process.env.BIRD_API_KEY = `bk_eu1_${'a'.repeat(32)}`;
    process.env.BIRD_SMS_SENDER = 'OrthoRoutes';
    expect(getBirdSmsConfig()).toBeNull();

    process.env.BIRD_API_BASE_URL = 'https://eu1.platform.bird.com/untrusted';
    expect(getBirdSmsConfig()).toBeNull();
    process.env.BIRD_API_BASE_URL = 'https://eu1.platform.bird.com';
    process.env.BIRD_SMS_SENDER = 'sender-too-long';
    expect(getBirdSmsConfig()).toBeNull();
    process.env.BIRD_SMS_SENDER = 'unsafe-id';
    expect(getBirdSmsConfig()).toBeNull();
  });
});
