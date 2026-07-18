import type { MockNotification } from '@/lib/types';

const legacyNotificationCopy: Record<string, string> = {
  'Создание поездки / маршрута будет добавлено в следующем mock-flow.':
    'Теперь вы можете создать поездку.',
};

export function NotificationCenter({ notifications }: { notifications: MockNotification[] }) {
  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h2 className="text-lg font-bold text-stone-950">Мои уведомления</h2>
      <p className="mt-2 text-sm leading-6 text-stone-700">
        Здесь собраны сообщения о ваших запросах и поездках.
      </p>
      {notifications.length > 0 ? (
        <ul className="mt-3 grid gap-2">
          {notifications.map((notification) => (
            <li className="rounded-md bg-white px-3 py-2 text-sm text-stone-700" key={notification.id}>
              {legacyNotificationCopy[notification.message] ?? notification.message}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-stone-600">Пока нет уведомлений.</p>
      )}
    </section>
  );
}
