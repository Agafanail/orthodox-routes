export type PublicSupabaseConfig = {
  key: string;
  url: string;
};

export type ServerSupabaseConfig = PublicSupabaseConfig;

export type ContextualRegistrationConfig = {
  appOrigin: string;
  secret: string;
};

export type BirdSmsConfig = {
  apiBaseUrl: string;
  apiKey: string;
  sender: string;
};

export type ResendNotificationConfig = {
  apiKey: string;
  appOrigin: string;
  from: string;
};

export type WebPushNotificationConfig = {
  keyVersion: number;
  privateKey: string;
  publicKey: string;
  subject: string;
};

export function getApplicationOrigin() {
  const appUrl = process.env.ORTHODOX_ROUTES_APP_URL?.trim();
  if (!appUrl) return null;

  try {
    const parsed = new URL(appUrl);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
      || (parsed.pathname !== '/' && parsed.pathname !== '')
    ) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function getJwtRole(key: string) {
  const payload = key.split('.')[1];
  if (!payload) return null;

  try {
    const normalized = payload.replaceAll('-', '+').replaceAll('_', '/');
    const decoded = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8')) as {
      role?: unknown;
    };
    return typeof decoded.role === 'string' ? decoded.role : null;
  } catch {
    return null;
  }
}

export function isSafePublicSupabaseKey(key: string) {
  const value = key.trim();
  if (!value || value.startsWith('sb_secret_')) return false;
  return getJwtRole(value) !== 'service_role';
}

export function hasPublicSupabaseConfigurationIntent() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
    || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim(),
  );
}

export function getPublicSupabaseConfig(): PublicSupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !key || !isSafePublicSupabaseKey(key)) return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  } catch {
    return null;
  }

  return { key, url };
}

export function isSafeServerSupabaseKey(key: string) {
  const value = key.trim();
  return value.startsWith('sb_secret_') || getJwtRole(value) === 'service_role';
}

export function getServerSupabaseConfig(): ServerSupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();

  if (!url || !key || !isSafeServerSupabaseKey(key)) return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  } catch {
    return null;
  }

  return { key, url };
}

export function getContextualRegistrationConfig(): ContextualRegistrationConfig | null {
  const appOrigin = getApplicationOrigin();
  const secret = process.env.CONTEXTUAL_REGISTRATION_SECRET?.trim();
  return appOrigin && secret && secret.length >= 32 ? { appOrigin, secret } : null;
}

export function getBirdSmsConfig(): BirdSmsConfig | null {
  const apiBaseUrl = process.env.BIRD_API_BASE_URL?.trim();
  const apiKey = process.env.BIRD_API_KEY?.trim();
  const sender = process.env.BIRD_SMS_SENDER?.trim();
  if (
    !apiBaseUrl
    || !apiKey
    || !sender
    || !/^bk_[a-z]{2}[0-9]+_[A-Za-z0-9_-]{16,}$/.test(apiKey)
    || !/^(?=.{1,11}$)(?=.*[A-Za-z])[A-Za-z0-9]+$/.test(sender)
  ) return null;

  try {
    const parsed = new URL(apiBaseUrl);
    const region = /^([a-z]{2}[0-9]+)\.platform\.bird\.com$/.exec(parsed.hostname)?.[1];
    const keyRegion = /^bk_([a-z]{2}[0-9]+)_/.exec(apiKey)?.[1];
    if (
      parsed.protocol !== 'https:'
      || parsed.username
      || parsed.password
      || parsed.port
      || parsed.search
      || parsed.hash
      || (parsed.pathname !== '/' && parsed.pathname !== '')
      || !region
      || region !== keyRegion
    ) return null;
    return { apiBaseUrl: parsed.origin, apiKey, sender };
  } catch {
    return null;
  }
}

function isSafeEmailAddress(value: string) {
  const mailbox = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  if (value.length > 254) return false;
  if (mailbox.test(value)) return true;
  const friendly = /^([^<>\r\n]{1,80}) <([^<>\r\n]+)>$/.exec(value);
  return Boolean(friendly && mailbox.test(friendly[2]));
}

export function getResendNotificationConfig(): ResendNotificationConfig | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_NOTIFICATION_FROM?.trim();
  const appOrigin = getApplicationOrigin();
  return apiKey && /^re_[A-Za-z0-9_-]{16,}$/.test(apiKey)
    && from && isSafeEmailAddress(from)
    && appOrigin
    ? { apiKey, appOrigin, from }
    : null;
}

export function getResendWebhookSecret() {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  return secret && /^whsec_[A-Za-z0-9_+/=-]{16,}$/.test(secret) ? secret : null;
}

export function getNotificationWorkerSecret() {
  const secret = process.env.NOTIFICATION_WORKER_SECRET?.trim();
  return secret && secret.length >= 32 && secret.length <= 256 && !/[\u0000-\u001f\u007f]/.test(secret)
    ? secret
    : null;
}

export function getWebPushNotificationConfig(): WebPushNotificationConfig | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  const keyVersion = Number(process.env.VAPID_KEY_VERSION?.trim());
  if (
    !publicKey || !/^[A-Za-z0-9_-]{87}$/.test(publicKey)
    || !privateKey || !/^[A-Za-z0-9_-]{43}$/.test(privateKey)
    || !subject || !Number.isSafeInteger(keyVersion) || keyVersion <= 0
  ) return null;

  try {
    if (subject.startsWith('mailto:')) {
      if (!isSafeEmailAddress(subject.slice(7))) return null;
    } else {
      const parsed = new URL(subject);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hostname === 'localhost') {
        return null;
      }
    }
  } catch {
    return null;
  }
  return { keyVersion, privateKey, publicKey, subject };
}
