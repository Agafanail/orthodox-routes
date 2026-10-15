import { GoogleAuth } from 'google-auth-library';
import type { GoogleTranslationConfig } from './config';
import { TRANSLATION_LANGUAGES, validSourceText } from './contract';
import type { TranslationAdapter } from './contract';

type Dependencies = {
  fetch?: typeof fetch;
  getAccessToken?: () => Promise<string | null>;
};

export function createGoogleTranslationAdapter(
  config: GoogleTranslationConfig, dependencies: Dependencies = {},
): TranslationAdapter {
  const parent = `projects/${config.projectId}/locations/${config.location}`;
  const auth = dependencies.getAccessToken ? null : new GoogleAuth({
    keyFilename: config.credentialsFile,
    projectId: config.projectId,
    scopes: ['https://www.googleapis.com/auth/cloud-translation'],
  });
  const getAccessToken = dependencies.getAccessToken ?? (() => auth!.getAccessToken());
  const request = dependencies.fetch ?? fetch;
  return {
    async translate(input, signal) {
      if (!TRANSLATION_LANGUAGES.has(input.sourceLanguage)
        || !TRANSLATION_LANGUAGES.has(input.targetLanguage)
        || input.sourceLanguage === input.targetLanguage
        || !validSourceText(input.fieldName, input.text)) {
        throw new Error('Translation input is unavailable.');
      }
      if (input.glossary && (config.location === 'global'
        || !input.glossary.resource.startsWith(`${parent}/glossaries/`)
        || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.glossary.resource.slice(`${parent}/glossaries/`.length))
        || !Number.isInteger(input.glossary.version) || input.glossary.version < 1)) {
        throw new Error('Translation glossary is unavailable.');
      }
      signal.throwIfAborted();
      let token: string | null | undefined;
      try {
        token = await getAccessToken();
      } catch {
        throw new Error('Translation authorization is unavailable.');
      }
      signal.throwIfAborted();
      if (!token) throw new Error('Translation authorization is unavailable.');
      const response = await request(`https://translate.googleapis.com/v3/${parent}:translateText`, {
        method: 'POST', redirect: 'error', cache: 'no-store', signal,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [input.text], mimeType: 'text/plain',
          sourceLanguageCode: input.sourceLanguage, targetLanguageCode: input.targetLanguage,
          model: `${parent}/models/general/nmt`,
          ...(input.glossary ? { glossaryConfig: { glossary: input.glossary.resource } } : {}),
        }),
      }).catch(() => { throw new Error('Translation provider is unavailable.'); });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('Translation provider is unavailable.');
      }
      const payload: unknown = await response.json().catch(() => null);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Translation output is unavailable.');
      }
      const items = (payload as Record<string, unknown>)[input.glossary ? 'glossaryTranslations' : 'translations'];
      if (!Array.isArray(items) || items.length !== 1 || !items[0]
        || typeof items[0] !== 'object' || typeof items[0].translatedText !== 'string'
        || !validSourceText(input.fieldName, items[0].translatedText)) {
        throw new Error('Translation output is unavailable.');
      }
      return {
        text: items[0].translatedText,
        providerName: 'google-cloud-translation', model: 'general/nmt',
        ...(input.glossary ? { glossaryVersion: input.glossary.version } : {}),
      };
    },
  };
}
