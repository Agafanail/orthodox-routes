import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

type FixtureUser = {
  role: 'passenger' | 'driver' | 'other';
  name: string;
  email: string;
  phone: string;
  loginUrl: string;
};

type CoreFixture = {
  api: { publicKey: string; url: string };
  churchUrl: string;
  markers: {
    driverExactOrigin: string;
    driverPublicArea: string;
    passengerExactPlace: string;
    passengerPublicArea: string;
  };
  savedPlaceLabels: { driver: string; passenger: string };
  users: FixtureUser[];
};

/**
 * Chooses a place through the real place field.
 *
 * The field offers a saved place and a provider-backed search. The browser check runs with no
 * map provider configured, so it takes the saved-place path deliberately: that is the offline
 * half of the field, and it is what a returning parishioner uses anyway.
 */
async function chooseSavedPlace(form: Locator, label: string) {
  const field = form.locator('[data-place-field]');
  await field.getByRole('button', { name: label, exact: true }).click();
  await expect(field.locator('[data-place-list] li').filter({ hasText: label })).toHaveCount(1);
}

function fixture(): CoreFixture {
  return JSON.parse(readFileSync(resolve('test-results/core-e2e-fixture.json'), 'utf8')) as CoreFixture;
}

function user(data: CoreFixture, role: FixtureUser['role']) {
  const found = data.users.find((entry) => entry.role === role);
  if (!found) throw new Error(`Missing ${role} browser fixture.`);
  return found;
}

async function signIn(page: Page, entry: FixtureUser, churchUrl: string) {
  await page.goto(entry.loginUrl);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL('http://127.0.0.1:3000/');
  await page.goto(churchUrl);
  await expect(page.getByText(`Вы вошли как ${entry.name}.`)).toBeVisible();
}

async function captureApplicationPayloads(page: Page, action: () => Promise<void>) {
  const reads: Promise<string>[] = [];
  const listener = (response: import('@playwright/test').Response) => {
    const type = response.request().resourceType();
    const contentType = response.headers()['content-type'] ?? '';
    if (
      response.url().startsWith('http://127.0.0.1:3000/')
      && (type === 'document' || type === 'fetch')
      && /(text\/html|text\/x-component|application\/json)/i.test(contentType)
    ) {
      reads.push(response.text().catch(() => ''));
    }
  };
  page.on('response', listener);
  try {
    await action();
  } finally {
    page.off('response', listener);
  }
  return [await page.content(), ...(await Promise.all(reads))].join('\n');
}

function expectMarkersAbsent(payload: string, markers: string[], boundary: string) {
  for (const marker of markers) {
    expect(payload.includes(marker), `${boundary} exposed a protected fixture marker`).toBe(false);
  }
}

function localDateTime(hoursFromNow: number) {
  const value = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function sessionAccessToken(contextCookies: Awaited<ReturnType<BrowserContext['cookies']>>, apiUrl: string) {
  const storageKey = `sb-${new URL(apiUrl).hostname.split('.')[0]}-auth-token`;
  const direct = contextCookies.find((cookie) => cookie.name === storageKey)?.value;
  const chunks = contextCookies
    .flatMap((cookie) => {
      const match = new RegExp(`^${storageKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(\\d+)$`).exec(cookie.name);
      return match ? [{ index: Number(match[1]), value: cookie.value }] : [];
    })
    .sort((left, right) => left.index - right.index)
    .map((chunk) => chunk.value)
    .join('');
  const encoded = direct ?? chunks;
  if (!encoded) throw new Error('Authenticated browser session cookie is missing.');
  const serialized = encoded.startsWith('base64-')
    ? Buffer.from(encoded.slice('base64-'.length), 'base64url').toString('utf8')
    : decodeURIComponent(encoded);
  const session = JSON.parse(serialized) as { access_token?: unknown } | unknown[];
  const token = Array.isArray(session) ? session[0] : session.access_token;
  if (typeof token !== 'string' || !token) throw new Error('Authenticated browser access token is unavailable.');
  return token;
}

async function rpc(
  context: BrowserContext,
  data: CoreFixture,
  name: string,
  body: Record<string, unknown> = {},
  authenticated = true,
) {
  const bearer = authenticated
    ? sessionAccessToken(await context.cookies(), data.api.url)
    : data.api.publicKey;
  return context.request.post(`${data.api.url}/rest/v1/rpc/${name}`, {
    data: body,
    failOnStatusCode: false,
    headers: {
      apikey: data.api.publicKey,
      Authorization: `Bearer ${bearer}`,
      'Content-Profile': 'api',
    },
  });
}

test('protects the Core agreement boundary across real isolated browser sessions', async ({ browser }) => {
  const data = fixture();
  const passenger = user(data, 'passenger');
  const driver = user(data, 'driver');
  const other = user(data, 'other');
  const anonymousContext = await browser.newContext();
  const passengerContext = await browser.newContext();
  const driverContext = await browser.newContext();
  const otherContext = await browser.newContext();
  const anonymousPage = await anonymousContext.newPage();
  const passengerPage = await passengerContext.newPage();
  const driverPage = await driverContext.newPage();
  const otherPage = await otherContext.newPage();

  try {
    await test.step('authenticate three eligible users in distinct contexts', async () => {
      await signIn(passengerPage, passenger, data.churchUrl);
      await signIn(driverPage, driver, data.churchUrl);
      await signIn(otherPage, other, data.churchUrl);
    });

    await test.step('publish a passenger request and driver offer through the configured UI', async () => {
      const passengerDetails = passengerPage.locator('details').filter({
        has: passengerPage.locator('summary').filter({ hasText: /^Попросить подвезти$/ }),
      }).first();
      const passengerForm = passengerDetails.locator('form');
      await passengerDetails.locator('summary').click();
      await passengerForm.getByLabel('Желаемое прибытие').fill(localDateTime(49));
      await chooseSavedPlace(passengerForm, data.savedPlaceLabels.passenger);
      await passengerForm.getByRole('button', { name: 'Опубликовать запрос', exact: true }).click();
      await expect(passengerPage.getByRole('status')).toHaveText('Запрос опубликован.');

      const driverDetails = driverPage.locator('details').filter({
        has: driverPage.locator('summary').filter({ hasText: /^Предложить разовую поездку$/ }),
      });
      const driverForm = driverDetails.locator('form');
      await driverDetails.locator('summary').click();
      await driverForm.getByLabel('Выезд', { exact: true }).fill(localDateTime(48));
      await driverForm.getByLabel('Прибытие', { exact: true }).fill(localDateTime(49));
      await chooseSavedPlace(driverForm, data.savedPlaceLabels.driver);
      await driverForm.getByRole('button', { name: 'Опубликовать поездку', exact: true }).click();
      await expect(driverPage.getByRole('status')).toHaveText('Предложение поездки опубликовано.');
    });

    await test.step('keep anonymous application payloads limited to approved public fields', async () => {
      const payload = await captureApplicationPayloads(anonymousPage, async () => {
        await anonymousPage.goto(data.churchUrl);
        await expect(anonymousPage.locator('[data-core-transport-board]')).toBeVisible();
      });
      await expect(anonymousPage.locator('p').filter({ hasText: data.markers.passengerPublicArea }).first()).toBeVisible();
      await expect(anonymousPage.locator('p').filter({ hasText: data.markers.driverPublicArea }).first()).toBeVisible();
      expectMarkersAbsent(payload, [
        passenger.email, passenger.phone, driver.email, driver.phone,
        data.markers.passengerExactPlace, data.markers.driverExactOrigin,
      ], 'Anonymous application payload');

      const anonymousDisclosure = await rpc(
        anonymousContext,
        data,
        'get_agreement_contacts',
        { p_agreement_id: '00000000-0000-4000-8000-000000000001' },
        false,
      );
      expect(anonymousDisclosure.ok()).toBe(false);
    });

    await test.step('coordinate a response without disclosing protected counterpart data', async () => {
      await driverPage.reload();
      const requestArticle = driverPage.locator('article').filter({ hasText: data.markers.passengerPublicArea });
      const responseForm = requestArticle.locator('form').filter({ has: driverPage.getByRole('button', { name: 'Предложить поездку', exact: true }) });
      await responseForm.getByRole('button', { name: 'Предложить поездку', exact: true }).click();
      await expect(driverPage.getByRole('status')).toHaveText('Ответ отправлен.');

      const passengerPayload = await captureApplicationPayloads(passengerPage, async () => {
        await passengerPage.reload();
        await expect(passengerPage.getByRole('button', { name: 'Подтвердить' })).toBeVisible();
      });
      const driverPayload = await captureApplicationPayloads(driverPage, async () => {
        await driverPage.reload();
        await expect(driverPage.getByRole('heading', { name: 'Ответы' })).toBeVisible();
      });
      expectMarkersAbsent(passengerPayload, [driver.email, driver.phone, data.markers.driverExactOrigin], 'Passenger pre-confirmation payload');
      expectMarkersAbsent(driverPayload, [passenger.email, passenger.phone, data.markers.passengerExactPlace], 'Driver pre-confirmation payload');

      const passengerAgreements = await rpc(passengerContext, data, 'current_ride_agreements');
      const driverAgreements = await rpc(driverContext, data, 'current_ride_agreements');
      expect(await passengerAgreements.json()).toEqual([]);
      expect(await driverAgreements.json()).toEqual([]);
    });

    let agreementId = '';
    await test.step('confirm once and disclose only each participant counterparty data', async () => {
      await passengerPage.getByRole('button', { name: 'Подтвердить' }).click();
      await expect(passengerPage.getByRole('status')).toHaveText('Договорённость подтверждена.');
      const agreementInput = passengerPage.locator('input[name="agreement_id"]').first();
      agreementId = await agreementInput.inputValue();
      expect(agreementId).toMatch(/^[0-9a-f-]{36}$/i);

      await passengerPage.getByRole('button', { name: 'Показать контакт и точное место' }).click();
      await expect(passengerPage.getByText(driver.email, { exact: false })).toBeVisible();
      await expect(passengerPage.getByText(driver.phone, { exact: false })).toBeVisible();
      await expect(passengerPage.getByText(data.markers.passengerExactPlace, { exact: true })).toBeVisible();
      await expect(passengerPage.getByText(passenger.email, { exact: false })).toHaveCount(0);

      await driverPage.reload();
      await driverPage.getByRole('button', { name: 'Показать контакт и точное место' }).click();
      await expect(driverPage.getByText(passenger.email, { exact: false })).toBeVisible();
      await expect(driverPage.getByText(passenger.phone, { exact: false })).toBeVisible();
      await expect(driverPage.getByText(data.markers.passengerExactPlace, { exact: true })).toBeVisible();
      await expect(driverPage.getByText(driver.email, { exact: false })).toHaveCount(0);

      const passengerContacts = await rpc(passengerContext, data, 'get_agreement_contacts', { p_agreement_id: agreementId });
      const driverContacts = await rpc(driverContext, data, 'get_agreement_contacts', { p_agreement_id: agreementId });
      const participantPlace = await rpc(passengerContext, data, 'get_agreement_exact_place', { p_agreement_id: agreementId });
      expect(await passengerContacts.json()).toMatchObject({ email: driver.email, phone: driver.phone });
      expect(await driverContacts.json()).toMatchObject({ email: passenger.email, phone: passenger.phone });
      expect(await participantPlace.json()).toMatchObject({ exact_meeting_label: data.markers.passengerExactPlace });
    });

    await test.step('deny an unrelated authenticated user at both application and RPC boundaries', async () => {
      const payload = await captureApplicationPayloads(otherPage, async () => {
        await otherPage.goto(`${data.churchUrl}?reveal=${agreementId}`);
        await expect(otherPage.getByText(`Вы вошли как ${other.name}.`)).toBeVisible();
      });
      expectMarkersAbsent(payload, [
        passenger.email, passenger.phone, driver.email, driver.phone,
        data.markers.passengerExactPlace, data.markers.driverExactOrigin,
      ], 'Unrelated-user application payload');
      await expect(otherPage.getByRole('heading', { name: 'Договорённости' })).toHaveCount(0);

      const contacts = await rpc(otherContext, data, 'get_agreement_contacts', { p_agreement_id: agreementId });
      const place = await rpc(otherContext, data, 'get_agreement_exact_place', { p_agreement_id: agreementId });
      expect(await contacts.json()).toBeNull();
      expect(await place.json()).toBeNull();
    });

    await test.step('cancel, revoke disclosure immediately, and explicitly restore the request', async () => {
      await passengerPage.getByRole('button', { name: 'Отменить договорённость' }).click();
      await expect(passengerPage.getByRole('status')).toHaveText('Договорённость отменена. Доступ к контактам закрыт.');

      const passengerContacts = await rpc(passengerContext, data, 'get_agreement_contacts', { p_agreement_id: agreementId });
      const driverPlace = await rpc(driverContext, data, 'get_agreement_exact_place', { p_agreement_id: agreementId });
      expect(await passengerContacts.json()).toBeNull();
      expect(await driverPlace.json()).toBeNull();

      await expect(passengerPage.getByRole('button', { name: 'Опубликовать снова' })).toBeVisible();
      await passengerPage.getByRole('button', { name: 'Опубликовать снова' }).click();
      await expect(passengerPage.getByRole('status')).toHaveText('Запрос снова опубликован.');
      await expect(passengerPage.getByText('Запрос: 1 из 1 мест · опубликовано')).toBeVisible();
    });
  } finally {
    await Promise.all([
      anonymousContext.close(), passengerContext.close(), driverContext.close(), otherContext.close(),
    ]);
  }
});
