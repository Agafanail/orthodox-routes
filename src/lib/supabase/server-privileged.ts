import { createClient } from '@supabase/supabase-js';
import { getServerSupabaseConfig } from './config';

export function createPrivilegedSupabaseClient() {
  const config = getServerSupabaseConfig();
  if (!config) return null;

  return createClient(config.url, config.key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
