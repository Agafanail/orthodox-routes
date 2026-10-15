import { describe, expect, it, vi } from 'vitest';
import { createGoogleTranslationAdapter } from './google';
import type { GoogleTranslationConfig } from './config';
import type { TranslationRequest } from './contract';

const config: GoogleTranslationConfig = {
  projectId: 'synthetic-project', location: 'us-central1', credentialsFile: '/synthetic.json',
  monthlyCharacterLimit: 10000, batchLimit: 5,
};
const input: TranslationRequest = {
  text: 'Orthodox Church', sourceLanguage: 'en', targetLanguage: 'ru',
  fieldName: 'official_name', idempotencyKey: 'a'.repeat(64),
};

describe('Google Cloud Translation adapter', () => {
  it('sends explicit plain text to the fixed API endpoint without internal identifiers', async () => {
    const request = vi.fn().mockResolvedValue(Response.json({
      translations: [{ translatedText: 'Православный храм' }],
    }));
    const adapter = createGoogleTranslationAdapter(config, {
      fetch: request, getAccessToken: async () => 'synthetic-token',
    });
    expect(await adapter.translate(input, new AbortController().signal)).toEqual({
      text: 'Православный храм', providerName: 'google-cloud-translation', model: 'general/nmt',
    });
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0];
    expect(url).toBe('https://translate.googleapis.com/v3/projects/synthetic-project/locations/us-central1:translateText');
    expect(JSON.parse(options.body)).toEqual({
      contents: ['Orthodox Church'], mimeType: 'text/plain',
      sourceLanguageCode: 'en', targetLanguageCode: 'ru',
      model: 'projects/synthetic-project/locations/us-central1/models/general/nmt',
    });
    expect(options.headers.authorization).toBe('Bearer synthetic-token');
    expect(options.redirect).toBe('error');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('uses the versioned glossary result only when project and location agree', async () => {
    const request = vi.fn().mockResolvedValue(Response.json({
      translations: [{ translatedText: 'Uncontrolled result' }],
      glossaryTranslations: [{ translatedText: 'Controlled result' }],
    }));
    const adapter = createGoogleTranslationAdapter(config, {
      fetch: request, getAccessToken: async () => 'synthetic-token',
    });
    const glossary = { resource: 'projects/synthetic-project/locations/us-central1/glossaries/orthodox-v1', version: 7 };
    expect(await adapter.translate({ ...input, glossary }, new AbortController().signal))
      .toMatchObject({ text: 'Controlled result', glossaryVersion: 7 });
    await expect(adapter.translate({ ...input, glossary: {
      ...glossary, resource: 'projects/other-project/locations/us-central1/glossaries/orthodox-v1',
    } }, new AbortController().signal)).rejects.toThrow('Translation glossary is unavailable.');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch after a timeout during token acquisition', async () => {
    const controller = new AbortController();
    const request = vi.fn();
    const adapter = createGoogleTranslationAdapter(config, {
      fetch: request,
      getAccessToken: async () => { controller.abort(); return 'synthetic-token'; },
    });
    await expect(adapter.translate(input, controller.signal)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects private fields before token acquisition and omits provider diagnostics from errors', async () => {
    const getAccessToken = vi.fn().mockResolvedValue('synthetic-token');
    const request = vi.fn().mockResolvedValue(new Response('private provider diagnostics', { status: 429 }));
    const adapter = createGoogleTranslationAdapter(config, { fetch: request, getAccessToken });
    await expect(adapter.translate({ ...input, fieldName: 'ride_comment' }, new AbortController().signal))
      .rejects.toThrow('Translation input is unavailable.');
    expect(getAccessToken).not.toHaveBeenCalled();
    await expect(adapter.translate(input, new AbortController().signal))
      .rejects.toThrow('Translation provider is unavailable.');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
