export type PublicSupabaseConfig = {
  key: string;
  url: string;
};

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
