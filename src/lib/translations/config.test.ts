import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGoogleTranslationConfig } from './config';

describe('Google translation configuration', () => {
  beforeEach(() => {
    vi.stubEnv('ORTHODOX_ROUTES_TRANSLATION_PROVIDER', 'google-cloud');
    vi.stubEnv('GOOGLE_TRANSLATION_PROJECT_ID', 'synthetic-project');
    vi.stubEnv('GOOGLE_TRANSLATION_LOCATION', 'us-central1');
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', join(tmpdir(), 'synthetic-credentials.json'));
    vi.stubEnv('TRANSLATION_MONTHLY_CHARACTER_LIMIT', '10000');
    vi.stubEnv('TRANSLATION_BATCH_LIMIT', '5');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('requires explicit provider, credential path, and owner-configured limits', () => {
    expect(getGoogleTranslationConfig()).toMatchObject({
      projectId: 'synthetic-project', location: 'us-central1',
      monthlyCharacterLimit: 10000, batchLimit: 5,
    });
    vi.stubEnv('ORTHODOX_ROUTES_TRANSLATION_PROVIDER', '');
    expect(getGoogleTranslationConfig()).toBeNull();
  });

  it.each([
    ['GOOGLE_TRANSLATION_PROJECT_ID', '../other-project'],
    ['GOOGLE_TRANSLATION_LOCATION', 'https://untrusted.example'],
    ['GOOGLE_TRANSLATION_LOCATION', 'europe-west1'],
    ['GOOGLE_APPLICATION_CREDENTIALS', 'relative.json'],
    ['TRANSLATION_MONTHLY_CHARACTER_LIMIT', ''],
    ['TRANSLATION_MONTHLY_CHARACTER_LIMIT', '0'],
    ['TRANSLATION_BATCH_LIMIT', '11'],
  ])('fails closed for unsafe or missing %s', (name, value) => {
    vi.stubEnv(name, value);
    expect(getGoogleTranslationConfig()).toBeNull();
  });

  it('accepts the global endpoint location without a glossary', () => {
    vi.stubEnv('GOOGLE_TRANSLATION_LOCATION', 'global');
    expect(getGoogleTranslationConfig()?.location).toBe('global');
  });
});
