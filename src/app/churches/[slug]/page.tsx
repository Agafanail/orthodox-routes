import Link from 'next/link';
import Image from 'next/image';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { ChurchTransportBoard } from '@/components/church-transport-board';
import { CoreTransportBoard } from '@/components/core-transport-board';
import {
  asRecord,
  parseCoreAgreements,
  parseCoreChurch,
  parseCoreDisclosure,
  parseCoreDriverOccurrences,
  parseCoreEligibility,
  parseCoreOwnedItems,
  parseCorePassengerRequests,
  parseCoreResponses,
} from '@/lib/core-transport/parse';
import {
  getChurchBySlug,
  getChurchDrivers,
  getChurchRoutes,
  getChurchTrips,
  mockChurches,
} from '@/lib/mockData';
import { parseSavedPlaces } from '@/lib/geo/place';
import { hasBrowserMapConfiguration } from '@/lib/geo/provider';
import { getPublicSupabaseConfig, hasPublicSupabaseConfigurationIntent } from '@/lib/supabase/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { CoreChurch } from '@/lib/core-transport/types';

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export function generateStaticParams() {
  return mockChurches.map((church) => ({ slug: church.slug }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function ChurchPage({ params, searchParams }: PageProps) {
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
  const backendConfigurationPresent = hasPublicSupabaseConfigurationIntent();
  const backendConfigured = getPublicSupabaseConfig() !== null;
  const query = await searchParams;
  const status = typeof query.status === 'string' ? query.status : undefined;
  const reveal = typeof query.reveal === 'string' && UUID.test(query.reveal) ? query.reveal : null;
  let coreBoard: ReactNode = null;
  let coreChurchForHeader: CoreChurch | null = null;

  if (backendConfigurationPresent && !backendConfigured) {
    coreBoard = <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-5">Транспортная доска временно недоступна.</p>;
  } else if (backendConfigured) {
    const supabase = await createServerSupabaseClient();
    if (!supabase) {
      coreBoard = <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-5">Транспортная доска временно недоступна.</p>;
    } else {
      const churchResult = await supabase.schema('api').rpc('transport_church_by_slug', { p_slug: slug });
      const coreChurch = parseCoreChurch(churchResult.data);
      if (churchResult.error || !coreChurch) {
        coreBoard = <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-5">Транспортная доска этого храма ещё не подключена.</p>;
      } else {
        coreChurchForHeader = coreChurch;
        const [requestsResult, occurrencesResult, claimsResult] = await Promise.all([
          supabase.schema('api').rpc('list_active_passenger_requests', { p_church_id: coreChurch.churchId }),
          supabase.schema('api').rpc('list_active_driver_occurrences', { p_church_id: coreChurch.churchId }),
          supabase.auth.getClaims(),
        ]);
        if (requestsResult.error || occurrencesResult.error) {
          coreBoard = <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-5">Не удалось загрузить транспортную доску. Попробуйте позже.</p>;
        } else {
          const signedIn = Boolean(claimsResult.data?.claims?.sub);
          let account: Record<string, unknown> | null = null;
          let owned = parseCoreOwnedItems(null);
          let responses: ReturnType<typeof parseCoreResponses> = [];
          let agreements: ReturnType<typeof parseCoreAgreements> = [];
          let savedPlaces: ReturnType<typeof parseSavedPlaces> = [];
          if (signedIn) {
            const [accountResult, ownedResult, responsesResult, agreementsResult, savedResult] = await Promise.all([
              supabase.schema('api').rpc('current_account'),
              supabase.schema('api').rpc('current_transport_items'),
              supabase.schema('api').rpc('current_ride_responses'),
              supabase.schema('api').rpc('current_ride_agreements'),
              supabase.schema('api').rpc('list_saved_places'),
            ]);
            account = accountResult.error ? null : asRecord(accountResult.data);
            owned = ownedResult.error ? owned : parseCoreOwnedItems(ownedResult.data);
            responses = responsesResult.error ? [] : parseCoreResponses(responsesResult.data);
            agreements = agreementsResult.error ? [] : parseCoreAgreements(agreementsResult.data);
            savedPlaces = savedResult.error ? [] : parseSavedPlaces(savedResult.data);
          }
          let disclosure;
          if (reveal && agreements.some((agreement) => agreement.agreementId === reveal && agreement.contactAvailable)) {
            const [contacts, place] = await Promise.all([
              supabase.schema('api').rpc('get_agreement_contacts', { p_agreement_id: reveal }),
              supabase.schema('api').rpc('get_agreement_exact_place', { p_agreement_id: reveal }),
            ]);
            if (!contacts.error && !place.error) disclosure = parseCoreDisclosure(reveal, contacts.data, place.data);
          }
          coreBoard = <CoreTransportBoard
            accountName={typeof account?.display_name === 'string' ? account.display_name : undefined}
            agreements={agreements}
            church={coreChurch}
            disclosure={disclosure}
            driverOccurrences={parseCoreDriverOccurrences(occurrencesResult.data)}
            eligibility={parseCoreEligibility(account?.eligibility)}
            mapAvailable={hasBrowserMapConfiguration()}
            ownedOccurrences={owned.ownedOccurrences}
            ownedRequests={owned.ownedRequests}
            ownedSeries={owned.ownedSeries}
            passengerRequests={parseCorePassengerRequests(requestsResult.data)}
            responses={responses}
            savedPlaces={savedPlaces}
            signedIn={signedIn}
            status={status}
          />;
        }
      }
    }
  }

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
            <h1 className="text-3xl font-bold text-stone-950">{coreChurchForHeader?.officialName ?? church.name}</h1>
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
                <dd className="mt-1 text-stone-700">{coreChurchForHeader?.address ?? church.address}</dd>
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

      {backendConfigurationPresent ? coreBoard : <ChurchTransportBoard
        church={church}
        drivers={drivers}
        participationBackendAvailable={false}
        routes={routes}
        trips={trips}
      />}
    </main>
  );
}
