import type { MockNotification } from '@/lib/types';

export function NotificationCenter({ notifications }: { notifications: MockNotification[] }) {
  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h2 className="text-lg font-bold text-stone-950">Мои уведомления</h2>
      <p className="mt-2 text-sm leading-6 text-stone-700">
        Это персональные mock-уведомления текущего пользователя. В реальном приложении они будут в личном центре
        уведомлений.
      </p>
      {notifications.length > 0 ? (
        <ul className="mt-3 grid gap-2">
          {notifications.map((notification) => (
            <li className="rounded-md bg-white px-3 py-2 text-sm text-stone-700" key={notification.id}>
              {notification.message}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-stone-600">Пока нет уведомлений.</p>
      )}
    </section>
  );
}
