import { MapPin, CarFront, Church, Bell } from 'lucide-react';
import { mockChurches, mockDrivers, mockRoutes, mockTrips } from '@/lib/mockData';

export default function HomePage() {
  const church = mockChurches[0];

  return (
    <main className="min-h-screen px-4 py-6">
      <section className="mx-auto max-w-5xl">
        <div className="rounded-3xl bg-white p-6 shadow-sm">
          <p className="mb-3 text-sm font-medium text-amber-700">MVP v0.1</p>
          <h1 className="text-3xl font-bold tracking-tight md:text-5xl">Православные маршруты</h1>
          <p className="mt-4 max-w-2xl text-lg text-slate-600">
            Найдите храм и попросите место у водителя, который уже едет на службу.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button className="rounded-2xl bg-slate-900 px-5 py-3 text-white">Мне нужно место</button>
            <button className="rounded-2xl border border-slate-300 px-5 py-3">Могу подвезти</button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <article className="rounded-3xl bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2 text-slate-700">
              <Church size={22} />
              <span className="font-semibold">Карточка храма</span>
            </div>
            <h2 className="text-2xl font-bold">{church.name}</h2>
            <p className="mt-2 text-slate-600">{church.address}</p>
            <p className="mt-2 text-sm text-slate-500">Языки: {church.languages.join(', ')}</p>
            <p className="mt-2 text-sm text-slate-500">Юрисдикция: {church.jurisdiction}</p>
            <a
              className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-slate-300 px-4 py-2"
              href={`https://www.google.com/maps/search/?api=1&query=${church.location.lat},${church.location.lng}`}
              target="_blank"
            >
              <MapPin size={18} /> Открыть в Google Maps
            </a>
          </article>

          <article className="rounded-3xl bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2 text-slate-700">
              <CarFront size={22} />
              <span className="font-semibold">Поездки и маршруты</span>
            </div>
            <p className="text-slate-600">Активных водителей: {mockDrivers.length}</p>
            <p className="text-slate-600">Регулярных маршрутов: {mockRoutes.length}</p>
            <p className="text-slate-600">Ближайших поездок: {mockTrips.length}</p>
            <div className="mt-4 rounded-2xl bg-slate-50 p-4">
              <p className="font-semibold">{mockRoutes[0].originLabel} → {church.name}</p>
              <p className="mt-1 text-sm text-slate-600">
                Каждое воскресенье, выезд {mockRoutes[0].recurrence.typicalDepartureTime}, мест: {mockRoutes[0].seats}
              </p>
            </div>
          </article>
        </div>

        <article className="mt-6 rounded-3xl bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2 text-slate-700">
            <Bell size={22} />
            <span className="font-semibold">Уведомления</span>
          </div>
          <p className="text-slate-600">
            В MVP будут in-app, push, email и Telegram-уведомления. WhatsApp — как кнопка связи после принятия заявки.
          </p>
        </article>
      </section>
    </main>
  );
}
