import type { NotificationDeliveryJob, NotificationMessage } from './adapter';

const copy = {
  de: ['Aktualisierung bei Orthodox Routes', 'In Orthodox Routes wartet eine Aktualisierung auf Sie.', 'Orthodox Routes öffnen'],
  en: ['Orthodox Routes update', 'An update is waiting for you in Orthodox Routes.', 'Open Orthodox Routes'],
  it: ['Aggiornamento Orthodox Routes', 'C’è un aggiornamento per te in Orthodox Routes.', 'Apri Orthodox Routes'],
  ro: ['Actualizare Orthodox Routes', 'Ai o actualizare în Orthodox Routes.', 'Deschide Orthodox Routes'],
  ru: ['Обновление Orthodox Routes', 'В Orthodox Routes вас ждёт обновление.', 'Открыть Orthodox Routes'],
  uk: ['Оновлення Orthodox Routes', 'В Orthodox Routes на вас чекає оновлення.', 'Відкрити Orthodox Routes'],
} as const;

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function renderNotificationMessage(
  job: NotificationDeliveryJob,
  appOrigin: string,
): NotificationMessage {
  const [subject, text, action] = copy[job.language] ?? copy.en;
  const destination = new URL(job.safeRoute, appOrigin).toString();
  return {
    email: {
      html: `<p>${escapeHtml(text)}</p><p><a href="${escapeHtml(destination)}">${escapeHtml(action)}</a></p>`,
      subject,
      text: `${text}\n\n${action}: ${destination}`,
    },
    push: JSON.stringify({
      eventType: job.eventType,
      notificationId: job.notificationId,
      route: job.safeRoute,
    }),
  };
}
