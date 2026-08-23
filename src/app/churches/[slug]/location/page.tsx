import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { parseCoreChurch } from '@/lib/core-transport/parse';
import { GEOAPIFY_ATTRIBUTION } from '@/lib/geo/geoapify';
import { hasBrowserMapConfiguration } from '@/lib/geo/provider';
import { getBrowserMapKey } from '@/lib/geo/provider-factory';
import { staticMapUrl } from '@/lib/geo/static-map';
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
  const destination = point ? `${point.lat},${point.lng}` : address;

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-6 sm:px-6">
      <nav className="mb-7">
        <Link className="font-semibold text-amber-800" href={`/churches/${slug}`}>
          Назад к храму
        </Link>
      </nav>

      <h1 className="text-3xl font-bold text-stone-950">{name}</h1>
      <p className="mt-3 text-lg text-stone-700" data-church-address>{address}</p>

      {hasBrowserMapConfiguration() && point && getBrowserMapKey() ? (
        <figure className="mt-5" data-church-lat={point.lat} data-church-lng={point.lng} data-church-location-map>
          {/* eslint-disable-next-line @next/next/no-img-element -- provider-rendered map tile, not a static asset */}
          <img
            alt={`Храм на карте: ${address}`}
            className="w-full rounded-lg border border-stone-200"
            height={360}
            src={staticMapUrl({
              apiKey: getBrowserMapKey()!,
              center: point,
              height: 360,
              markers: [{ ...point, kind: 'church' }],
              width: 640,
              zoom: 16,
            })}
            width={640}
          />
          <figcaption className="mt-1 text-xs text-stone-500">{GEOAPIFY_ATTRIBUTION}</figcaption>
        </figure>
      ) : (
        <p className="mt-5 rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600" data-church-location-map-unavailable>
          Карта сейчас недоступна. Полный адрес храма указан выше.
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        <a
          className="rounded-lg border border-amber-800 px-4 py-2 font-semibold text-amber-900"
          href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`}
          rel="noreferrer noopener"
          target="_blank"
        >
          Построить маршрут
        </a>
        <a
          className="rounded-lg border border-stone-300 px-4 py-2 font-semibold text-stone-700"
          href={`https://yandex.ru/maps/?rtext=~${encodeURIComponent(destination)}`}
          rel="noreferrer noopener"
          target="_blank"
        >
          Маршрут в Яндекс Картах
        </a>
      </div>

      <p className="mt-5 text-sm text-stone-600">
        Маршрут строится во внешнем приложении карт. Внутри Orthodox Routes навигации нет.
      </p>
    </main>
  );
}
