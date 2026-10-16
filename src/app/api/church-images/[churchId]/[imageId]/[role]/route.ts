import { readPublishedChurchImage } from '@/lib/church-images/delivery';
import { SupabaseChurchImageStorage } from '@/lib/church-images/storage';
import { createPrivilegedSupabaseClient } from '@/lib/supabase/server-privileged';

export const dynamic = 'force-dynamic';

type Context = {
  params: Promise<{ churchId: string; imageId: string; role: string }>;
};

export async function GET(_request: Request, context: Context) {
  const client = createPrivilegedSupabaseClient();
  if (!client) return Response.json({ status: 'unavailable' }, {
    headers: { 'cache-control': 'private, no-store' }, status: 503,
  });
  try {
    const { churchId, imageId, role } = await context.params;
    const image = await readPublishedChurchImage(
      client,
      new SupabaseChurchImageStorage(client),
      churchId,
      imageId,
      role,
    );
    if (!image) return Response.json({ status: 'not_found' }, {
      headers: { 'cache-control': 'private, no-store' }, status: 404,
    });
    return new Response(Uint8Array.from(image.bytes), {
      headers: {
        'cache-control': 'private, no-store',
        'content-length': `${image.bytes.length}`,
        'content-type': image.metadata.contentType,
        'cross-origin-resource-policy': 'same-origin',
        'x-content-type-options': 'nosniff',
      },
      status: 200,
    });
  } catch {
    return Response.json({ status: 'unavailable' }, {
      headers: { 'cache-control': 'private, no-store' }, status: 503,
    });
  }
}
