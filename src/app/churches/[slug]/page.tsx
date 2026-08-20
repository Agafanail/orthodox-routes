import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { ChurchTransportBoard } from '@/components/church-transport-board';
import {
  getChurchBySlug,
  getChurchDrivers,
  getChurchRoutes,
  getChurchTrips,
  mockChurches,
} from '@/lib/mockData';
import {
  getApplicationOrigin,
  getContextualRegistrationConfig,
  getPublicSupabaseConfig,
  getServerSupabaseConfig,
} from '@/lib/supabase/config';

type PageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return mockChurches.map((church) => ({ slug: church.slug }));
}

export default async function ChurchPage({ params }: PageProps) {
  await connection();
  const now = new Date();
  const { slug } = await params;
  const church = getChurchBySlug(slug);

  if (!church) {
    notFound();
  }

  const drivers = getChurchDrivers(church.id);
  const routes = getChurchRoutes(church.id);
  const trips = getChurchTrips(church.id, now);
  const participationBackendAvailable = getApplicationOrigin() !== null
    && getContextualRegistrationConfig() !== null
    && getPublicSupabaseConfig() !== null
    && getServerSupabaseConfig() !== null;

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <nav className="mb-7 flex items-center justify-between">
        <Link className="font-bold" href="/churches">
          Храмы
        </Link>
        <Link className="text-sm font-semibold text-amber-800" href="/drivers">
          Водители
        </Link>
      </nav>

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-amber-800">Как мне попасть в храм?</p>
        <div className="mt-3 grid gap-5 lg:grid-cols-[1fr_360px] lg:items-stretch">
          <div>
            <div className="mb-3 inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
              Транспортная доска храма
            </div>
            <h1 className="text-3xl font-bold text-stone-950">{church.name}</h1>
            <p className="mt-3 leading-7 text-stone-700">{church.jurisdiction}</p>
            <p className="mt-3 text-sm leading-6 text-stone-600">
              Здесь можно попросить подвезти или предложить поездку.
            </p>
            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-lg bg-stone-100 p-4">
                <dt className="font-semibold">Языки</dt>
                <dd className="mt-1 text-stone-700">{church.languages.join(', ')}</dd>
              </div>
              <div className="rounded-lg bg-stone-100 p-4">
                <dt className="font-semibold">Адрес</dt>
                <dd className="mt-1 text-stone-700">{church.address}</dd>
              </div>
            </dl>
          </div>
          <div className="relative min-h-60 overflow-hidden rounded-lg bg-stone-100">
            <Image
              alt={church.imageAlt}
              className="object-cover"
              fill
              priority
              sizes="(max-width: 1023px) 100vw, 360px"
              src={church.imageUrl}
            />
          </div>
        </div>
      </section>

      <section className="mt-5 rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Расписание</h2>
        <p className="mt-3 leading-7 text-stone-700">{church.schedule?.regular ?? 'Расписание пока не указано.'}</p>
        {church.schedule?.exceptions ? <p className="mt-2 text-sm text-stone-600">{church.schedule.exceptions}</p> : null}
      </section>

      <ChurchTransportBoard
        church={church}
        drivers={drivers}
        participationBackendAvailable={participationBackendAvailable}
        routes={routes}
        trips={trips}
      />
    </main>
  );
}
