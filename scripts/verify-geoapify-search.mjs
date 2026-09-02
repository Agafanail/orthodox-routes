// A small real-world address-search check against Geoapify.
//
// The purpose is narrow: confirm that the approved place-picker flow stays usable across the
// countries Orthodox Routes actually serves. It is not a provider comparison, and it does not
// require every query to be perfect — the flow deliberately lets a person correct the result on
// the interactive map or drop a pin by hand.
//
// It calls the same documented endpoint, with the same parameters, that the application adapter
// uses; the adapter's own parsing and failure handling are covered by unit tests. It reads the
// server credential from the environment, prints no credential, and stores nothing. Run it by
// hand: it is deliberately not part of automated CI.

import process from 'node:process';

const apiKey = process.env.ORTHODOX_ROUTES_MAP_SERVER_KEY?.trim();
if (!apiKey) {
  console.error('Set ORTHODOX_ROUTES_MAP_SERVER_KEY for this check. Never paste it into a chat or a commit.');
  process.exit(1);
}

// Representative of the target geography: one urban and one smaller locality per country.
const cases = [
  { country: 'Italy', kind: 'город', near: { lat: 45.0703, lng: 7.6869 }, query: 'Via Roma 1, Torino' },
  { country: 'Italy', kind: 'малый населённый пункт', near: { lat: 38.9097, lng: 16.5877 }, query: 'Squillace, Via Nazionale' },
  { country: 'USA', kind: 'город', near: { lat: 40.7128, lng: -74.006 }, query: '15 East 97th Street, New York' },
  { country: 'USA', kind: 'малый населённый пункт', near: { lat: 42.4406, lng: -76.4966 }, query: 'Main Street, Trumansburg, NY' },
  { country: 'Belarus', kind: 'город', near: { lat: 53.9023, lng: 27.5619 }, query: 'проспект Независимости 1, Минск' },
  { country: 'Belarus', kind: 'малый населённый пункт', near: { lat: 53.1327, lng: 26.0189 }, query: 'Несвиж, Замковая' },
  { country: 'Russia', kind: 'город', near: { lat: 55.7558, lng: 37.6173 }, query: 'улица Варварка 2, Москва' },
  { country: 'Russia', kind: 'малый населённый пункт', near: { lat: 56.7395, lng: 38.852 }, query: 'Переславль-Залесский, Советская улица' },
];

async function search({ near, query }) {
  const url = new URL('https://api.geoapify.com/v1/geocode/autocomplete');
  url.searchParams.set('text', query);
  url.searchParams.set('format', 'geojson');
  url.searchParams.set('limit', '5');
  url.searchParams.set('lang', 'ru');
  url.searchParams.set('bias', `proximity:${near.lng},${near.lat}`);
  url.searchParams.set('apiKey', apiKey);

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('unavailable');
  const payload = await response.json();
  return Array.isArray(payload?.features) ? payload.features : [];
}

const rows = [];
let usable = 0;

for (const testCase of cases) {
  try {
    const features = await search(testCase);
    const top = features[0]?.properties;
    // "Usable" means the picker has somewhere to start. A rough result still counts, because the
    // person confirms and corrects the point on the map before publishing.
    if (top) usable += 1;
    rows.push({
      ...testCase,
      coordinate: top ? `${Number(top.lat).toFixed(4)}, ${Number(top.lon).toFixed(4)}` : '—',
      results: features.length,
      top: top?.formatted ?? '—',
    });
  } catch {
    rows.push({ ...testCase, coordinate: '—', results: 0, top: 'провайдер недоступен' });
  }
}

for (const row of rows) {
  console.log(`${row.country} · ${row.kind}\n  запрос: ${row.query}\n  найдено: ${row.results}\n  первый: ${row.top}\n  координата: ${row.coordinate}\n`);
}
console.log(`${usable} из ${cases.length} запросов дали результат, с которого можно начать выбор места.`);
console.log('Слабый или отсутствующий результат не является отказом: место можно поправить на карте или поставить отметку вручную.');
