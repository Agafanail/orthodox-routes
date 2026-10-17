import type { NotificationDeliveryJob, NotificationMessage } from './adapter';
import { getPreparedNotificationText } from './prepared-copy';

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function renderNotificationMessage(
  job: NotificationDeliveryJob,
  appOrigin: string,
): NotificationMessage {
  const subject = getPreparedNotificationText('notifications.subject', job.language).text;
  const text = getPreparedNotificationText(job.localizationKey, job.language).text;
  const action = getPreparedNotificationText('notifications.open', job.language).text;
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
