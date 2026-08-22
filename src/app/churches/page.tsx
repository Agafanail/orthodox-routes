import Link from 'next/link';
import { connection } from 'next/server';
import { ChurchCatalog } from '@/components/church-catalog';
import { ChurchList } from '@/components/church-list';
import { parseCatalogChurches, parseCoarseLocation } from '@/lib/geo/church';
import { hasBrowserMapConfiguration } from '@/lib/geo/provider';
import { mockChurches, mockDrivers, mockRoutes, mockTrips } from '@/lib/mockData';
import { getPublicSupabaseConfig } from '@/lib/supabase/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ChurchesPage({ searchParams }: PageProps) {
  await connection();
  const now = new Date();
  const query = await searchParams;
  const search = typeof query.q === 'string' ? query.q.slice(0, 120).trim() : '';
  // A location reaches this page only after the explicit action, and only rounded.
  const near = parseCoarseLocation(query.lat, query.lng);
  const backendConfigured = getPublicSupabaseConfig() !== null;

  let catalog = null;
  if (backendConfigured) {
    const supabase = await createServerSupabaseClient();
    if (supabase) {
      const result = await supabase.schema('api').rpc('search_published_churches', {
        p_lat: near?.lat ?? null,
        p_lng: near?.lng ?? null,
        p_limit: 50,
        p_query: search.length > 0 ? search : null,
      });
      catalog = result.error ? null : parseCatalogChurches(result.data);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <nav className="mb-7 flex items-center justify-between">
        <Link className="font-bold" href="/">
          Православные маршруты
        </Link>
        <Link className="text-sm font-semibold text-amber-800" href="/drivers">
          Водители
        </Link>
      </nav>

      <h1 className="text-3xl font-bold text-stone-950">Храмы</h1>
      <p className="mt-3 max-w-2xl leading-7 text-stone-700">
        Выберите храм, чтобы увидеть регулярные и разовые поездки, а также водителей, которые уже едут туда.
      </p>

      {catalog ? (
        <ChurchCatalog
          churches={catalog}
          mapAvailable={hasBrowserMapConfiguration()}
          near={near}
          query={search}
        />
      ) : backendConfigured ? (
        <p className="mt-7 rounded-lg border border-amber-200 bg-amber-50 p-5">
          Каталог храмов временно недоступен. Попробуйте позже.
        </p>
      ) : (
        <ChurchList
          churches={mockChurches}
          drivers={mockDrivers}
          initialNow={now.toISOString()}
          routes={mockRoutes}
          trips={mockTrips}
        />
      )}
    </main>
  );
}
