import Link from 'next/link';
import { mockChurches, mockDrivers, mockRoutes, mockTrips } from '@/lib/mockData';

const links = [
  { href: '/churches', label: 'Все храмы', text: 'Посмотреть храмы с доступными маршрутами.' },
  { href: '/churches/pokrov-catanzaro', label: 'Покров в Катандзаро', text: 'Открыть пример карточки храма.' },
  { href: '/drivers', label: 'Водители', text: 'Увидеть публичные профили без контактов.' },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-5 sm:px-6 lg:px-8">
      <header className="flex items-center justify-between gap-4 py-3">
        <Link className="text-lg font-bold" href="/">
          Православные маршруты
        </Link>
        <Link className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold" href="/churches">
          Найти храм
        </Link>
      </header>

      <section className="grid flex-1 content-center gap-8 py-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-amber-800">Mock-only MVP</p>
          <h1 className="mt-3 text-4xl font-bold tracking-normal text-stone-950 sm:text-5xl">
            Как мне попасть в храм?
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-stone-700">
            Сервис соединяет пассажира без машины с водителем, который уже едет в конкретный православный храм.
            Сейчас это чистый прототип на mock data: без Firebase, авторизации, карт, Telegram, платежей, SMS и
            WhatsApp API.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Link className="rounded-lg bg-stone-950 px-5 py-4 text-center font-semibold text-white" href="/churches">
              Смотреть храмы
            </Link>
            <Link
              className="rounded-lg border border-stone-300 bg-white px-5 py-4 text-center font-semibold text-stone-950"
              href="/churches/pokrov-catanzaro"
            >
              Мне нужно место
            </Link>
          </div>
        </div>

        <aside className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Что уже есть</h2>
          <dl className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-stone-100 p-4">
              <dt className="text-sm text-stone-600">Храмы</dt>
              <dd className="text-3xl font-bold">{mockChurches.length}</dd>
            </div>
            <div className="rounded-lg bg-stone-100 p-4">
              <dt className="text-sm text-stone-600">Водители</dt>
              <dd className="text-3xl font-bold">{mockDrivers.length}</dd>
            </div>
            <div className="rounded-lg bg-stone-100 p-4">
              <dt className="text-sm text-stone-600">Маршруты</dt>
              <dd className="text-3xl font-bold">{mockRoutes.length}</dd>
            </div>
            <div className="rounded-lg bg-stone-100 p-4">
              <dt className="text-sm text-stone-600">Поездки</dt>
              <dd className="text-3xl font-bold">{mockTrips.length}</dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className="grid gap-4 pb-8 md:grid-cols-3">
        {links.map((link) => (
          <Link
            className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm transition hover:border-amber-700"
            href={link.href}
            key={link.href}
          >
            <h2 className="text-lg font-bold">{link.label}</h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">{link.text}</p>
          </Link>
        ))}
      </section>
    </main>
  );
}
