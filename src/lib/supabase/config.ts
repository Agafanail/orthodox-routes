export type PublicSupabaseConfig = {
  key: string;
  url: string;
};

export type ServerSupabaseConfig = PublicSupabaseConfig;

export type ContextualRegistrationConfig = {
  appOrigin: string;
  secret: string;
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
