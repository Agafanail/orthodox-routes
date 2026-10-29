import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NotificationDeliveryJob } from './adapter';
import { renderNotificationMessage } from './messages';
import { getPreparedNotificationText, preparedNotificationCopy } from './prepared-copy';

const languages = ['de', 'en', 'it', 'ro', 'ru', 'uk'] as const;
const job: NotificationDeliveryJob = {
  attemptCount: 1, authKey: null, channel: 'email', destinationValue: 'synthetic@example.org',
  eventType: 'ride.confirmed', jobId: '019c7134-a39b-7d8e-a4ad-8b11d56d0011', language: 'ru',
  localizationKey: 'notifications.ride_confirmed', notificationId: '019c7134-a39b-7d8e-a4ad-8b11d56d0022',
  p256dhKey: null, safeParameters: {}, safeRoute: '/trips', vapidKeyVersion: null,
};

describe('prepared notification copy', () => {
  it.each(languages)('preserves the cancellation church destination in %s email and minimized push', (language) => {
    const safeRoute = '/churches/synthetic-restoration-church';
    const result = renderNotificationMessage({ ...job, language, safeRoute,
      eventType: 'ride.cancelled', localizationKey: 'notifications.ride_cancelled' }, 'https://routes.example.org');
    expect(result.email.text).toContain(`https://routes.example.org${safeRoute}`);
    expect(result.email.html).toContain(`href="https://routes.example.org${safeRoute}"`);
    expect(JSON.parse(result.push)).toEqual({ eventType: 'ride.cancelled', notificationId: job.notificationId, route: safeRoute });
    expect(JSON.stringify(result)).not.toContain(job.destinationValue);
    expect(JSON.stringify(result)).not.toContain('/trips');
  });
  it('keeps every stable key versioned and complete in all six languages', () => {
    for (const [key, entry] of Object.entries(preparedNotificationCopy)) {
      expect(key).toMatch(/^[a-z][a-z0-9_.]+$/);
      expect(Number.isInteger(entry.version) && entry.version > 0).toBe(true);
      expect(Object.keys(entry.translations).sort()).toEqual(languages);
      for (const language of languages) {
        const value = entry.translations[language];
        expect(value.trim()).toBe(value);
        expect(value.length).toBeGreaterThan(0);
        expect(value.length).toBeLessThanOrEqual(256);
        // No runtime interpolation, markup, addresses, or hard-coded counts/plural forms.
        expect(value).not.toMatch(/[{}<>\d@\u0000-\u001f\u007f]/);
        expect(getPreparedNotificationText(key, language)).toEqual({ key, language, text: value, version: entry.version });
      }
    }
  });

  it('covers emitted literal keys and every dynamically generated response/change key', () => {
    const migrationDirectory = join(process.cwd(), 'supabase', 'migrations');
    const migrations = readdirSync(migrationDirectory).filter((name) => name.endsWith('.sql'))
      .map((name) => readFileSync(join(migrationDirectory, name), 'utf8')).join('\n');
    const literalKeys = [...migrations.matchAll(/'(notifications\.[a-z_]+)'/g)].map((match) => match[1]);
    const generatedKeys = [
      ...['response_received', 'counteroffer_received', 'response_declined', 'response_withdrawn']
        .map((suffix) => `notifications.ride_${suffix}`),
      ...['accepted', 'declined', 'expired', 'cancelled'].map((state) => `notifications.ride_change_${state}`),
      'church.address.updated', 'church.service.updated', 'church.service.rescheduled', 'church.service.cancelled',
    ];
    for (const key of new Set([...literalKeys, ...generatedKeys])) {
      expect(Object.hasOwn(preparedNotificationCopy, key), key).toBe(true);
    }
  });

  it('falls back deterministically without prototype-property lookup', () => {
    for (const key of ['notifications.future_unknown', '__proto__', 'constructor', 'toString']) {
      expect(getPreparedNotificationText(key, 'ru')).toEqual({
        key: 'notifications.update', language: 'ru', version: 1,
        text: 'В Orthodox Routes вас ждёт обновление.',
      });
    }
    for (const language of ['fr', '', '__proto__', 'constructor', 'ru-RU']) {
      expect(getPreparedNotificationText('notifications.ride_confirmed', language)).toEqual({
        key: 'notifications.ride_confirmed', language: 'en', version: 1,
        text: preparedNotificationCopy['notifications.ride_confirmed'].translations.en,
      });
    }
  });

  it.each(languages)('renders prepared %s email while preserving the minimized push contract', (language) => {
    const result = renderNotificationMessage({ ...job, language }, 'https://routes.example.org');
    expect(result.email.subject).toBe(getPreparedNotificationText('notifications.subject', language).text);
    expect(result.email.text).toBe([
      getPreparedNotificationText(job.localizationKey, language).text,
      `${getPreparedNotificationText('notifications.open', language).text}: https://routes.example.org/trips`,
    ].join('\n\n'));
    expect(result.email.html).toContain('href="https://routes.example.org/trips"');
    expect(JSON.parse(result.push)).toEqual({
      eventType: job.eventType, notificationId: job.notificationId, route: job.safeRoute,
    });
  });

  it('does not echo destinations, keys, notes, coordinates, names, or arbitrary safe parameters', () => {
    const result = renderNotificationMessage({
      ...job, authKey: 'synthetic-auth-secret', p256dhKey: 'synthetic-key-secret',
      safeParameters: {
        note: '<script>synthetic-private-note</script>', email: 'synthetic-private@example.org',
        phone: '+390000000001', lat: 45.123456, lng: 7.123456, name: 'Synthetic Private Person',
      },
    }, 'https://routes.example.org');
    const rendered = JSON.stringify(result);
    for (const privateValue of [job.destinationValue, 'synthetic-auth-secret', 'synthetic-key-secret',
      '<script>', 'synthetic-private', '+390000000001', '45.123456', '7.123456', 'Synthetic Private Person']) {
      expect(rendered).not.toContain(privateValue);
    }
    expect(result).toEqual(renderNotificationMessage(job, 'https://routes.example.org'));
  });

  it('preserves generic fallback copy and escapes the complete email link', () => {
    const result = renderNotificationMessage({ ...job, localizationKey: 'notifications.future_unknown', safeRoute: '/trips?x=1&y=2' },
      'https://routes.example.org');
    expect(result.email.text).toContain('В Orthodox Routes вас ждёт обновление.');
    expect(result.email.html).toContain('href="https://routes.example.org/trips?x=1&amp;y=2"');
  });
});
