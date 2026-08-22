import Link from 'next/link';
import { approximateDistance, type CatalogChurch } from '@/lib/geo/church';
import type { Coordinate } from '@/lib/geo/types';
import { CatalogMap } from './catalog-map';
import { NearMeAction } from './near-me-action';

/**
 * The public church catalog: one list, one map of the same churches, and one universal search.
 *
 * The list is the dependable half. The map is an additional way to look at the same result, so
 * a missing map surface never stops a person from finding a church.
 */
export function ChurchCatalog({
  churches,
  mapAvailable,
  near,
  query,
}: {
  churches: CatalogChurch[];
  mapAvailable: boolean;
  near: Coordinate | null;
  query: string;
}) {
  return (
    <section className="mt-7 grid gap-5" data-church-catalog>
      <form action="/churches" className="flex flex-wrap items-end gap-3" method="get">
        <label className="grid flex-1 gap-1 text-sm">
          Поиск храма
          <input
            className="rounded-lg border border-stone-300 p-2"
            defaultValue={query}
            maxLength={120}
            name="q"
            placeholder="Название, город или страна"
            type="search"
          />
        </label>
        <button className="rounded-lg bg-amber-800 px-4 py-2 font-semibold text-white" type="submit">
          Найти
        </button>
        <NearMeAction query={query} />
      </form>

      {near ? (
        <p className="text-sm text-stone-600" data-catalog-near>
          Сначала показаны ближайшие храмы. Расстояние примерное.
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_360px] lg:items-start">
        <div className="grid gap-4 sm:grid-cols-2" data-catalog-list>
          {churches.length === 0 ? (
            <p className="text-stone-600">Храмы не найдены. Попробуйте другое название или город.</p>
          ) : churches.map((church) => (
            <Link
              className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm transition hover:border-amber-700"
              href={`/churches/${church.slug}`}
              key={church.churchId}
            >
              <h2 className="text-xl font-bold">{church.officialName}</h2>
              <p className="mt-2 text-sm text-stone-600">{church.address}</p>
              <p className="mt-1 text-sm text-stone-600">{church.locality}, {church.countryCode}</p>
              {approximateDistance(church.distanceM) ? (
                <p className="mt-2 text-sm font-semibold text-amber-900" data-catalog-distance>
                  {approximateDistance(church.distanceM)}
                </p>
              ) : null}
            </Link>
          ))}
        </div>

        <CatalogMap churches={churches} mapAvailable={mapAvailable} near={near} />
      </div>
    </section>
  );
}
