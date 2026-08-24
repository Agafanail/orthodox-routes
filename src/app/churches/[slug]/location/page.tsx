import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { ExternalMapLinks } from '@/components/external-map-links';
import { InteractiveMap } from '@/components/interactive-map';
import { parseCoreChurch } from '@/lib/core-transport/parse';
import { hasBrowserMapConfiguration } from '@/lib/geo/provider';
import { getBrowserMapKey } from '@/lib/geo/provider-factory';
import { getChurchBySlug } from '@/lib/mockData';
import { getPublicSupabaseConfig } from '@/lib/supabase/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';

type PageProps = {
  params: Promise<{ slug: string }>;
};

/**
 * The dedicated church location view.
 *
 * The church page keeps its exact public address visible and does not embed a large map; the
 * address itself opens this screen, where the map and an external route belong. A church
 * location is public and exact, so nothing here is approximated.
 */
export default async function ChurchLocationPage({ params }: PageProps) {
  await connection();
  const { slug } = await params;
  const fallback = getChurchBySlug(slug);
  const backendConfigured = getPublicSupabaseConfig() !== null;

  let church = null;
  if (backendConfigured) {
    const supabase = await createServerSupabaseClient();
    if (supabase) {
      const result = await supabase.schema('api').rpc('transport_church_by_slug', { p_slug: slug });
      church = result.error ? null : parseCoreChurch(result.data);
    }
  }

  const name = church?.officialName ?? fallback?.name;
  const address = church?.address ?? fallback?.address;
  if (!name || !address) notFound();

  const point = church && church.lat !== undefined && church.lng !== undefined
    ? { lat: church.lat, lng: church.lng }
    : null;

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-6 sm:px-6">
      <nav className="mb-7">
        <Link className="font-semibold text-amber-800" href={`/churches/${slug}`}>
          Назад к храму
        </Link>
      </nav>

      <h1 className="text-3xl font-bold text-stone-950">{name}</h1>
      <p className="mt-3 text-lg text-stone-700" data-church-address>{address}</p>

      {point ? (
        <div className="mt-5" data-church-lat={point.lat} data-church-lng={point.lng} data-church-location-map>
          <InteractiveMap
            ariaLabel={`Храм на карте: ${address}`}
            browserKey={hasBrowserMapConfiguration() ? getBrowserMapKey() : null}
            center={point}
            heightClass="h-96"
            markers={[{ id: 'church', kind: 'church', label: name, ...point }]}
            unavailableText="Карта сейчас недоступна. Полный адрес храма указан выше."
            zoom={16}
          />
        </div>
      ) : (
        <p className="mt-5 rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600" data-church-location-map-unavailable>
          Карта сейчас недоступна. Полный адрес храма указан выше.
        </p>
      )}

      {point ? <ExternalMapLinks mode="route" target={{ label: name, point }} title="Построить маршрут" /> : null}

      <p className="mt-5 text-sm text-stone-600">
        Маршрут строится во внешнем приложении карт. Внутри Orthodox Routes навигации нет.
      </p>
    </main>
  );
}
