import { cookies, headers } from 'next/headers';
import { getPublicSupabaseConfig } from '@/lib/supabase/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createComplaintReporterResolver, type ComplaintReporter } from './reporter';

// Unwired server seam, not an endpoint or complaint receipt. Call only after the
// same-origin/body intake boundary; this does not establish proxy/network trust.
export async function resolveComplaintReporter(): Promise<ComplaintReporter> {
  try {
    const config = getPublicSupabaseConfig();
    if (!config) return { status: 'unavailable' };
    const [jar, requestHeaders, client] = await Promise.all([cookies(), headers(), createServerSupabaseClient()]);
    return await createComplaintReporterResolver({ client, supabaseUrl: config.url })(
      jar.getAll().map(({ name }) => name), requestHeaders.has('authorization'),
    );
  } catch { return { status: 'unavailable' }; }
}
