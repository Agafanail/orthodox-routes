export const TRANSLATION_LANGUAGES = new Set(['en', 'ru', 'it', 'ro', 'uk', 'de']);
export const TRANSLATION_FIELD_LIMITS: Record<string, number> = {
  official_name: 200,
  source_name: 160,
  description_source: 4000,
  source_description: 4000,
};

export type TranslationGlossary = { resource: string; version: number };
export type TranslationRequest = {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  fieldName: string;
  idempotencyKey: string;
  glossary?: TranslationGlossary;
};
export type TranslationAdapter = {
  translate(request: TranslationRequest, signal: AbortSignal): Promise<{
    text: string;
    providerName: string;
    model?: string;
    glossaryVersion?: number;
  }>;
};

export function validSourceText(fieldName: string, value: string) {
  if (!Object.hasOwn(TRANSLATION_FIELD_LIMITS, fieldName)) return false;
  const length = Array.from(value).length;
  if (length < 1 || length > TRANSLATION_FIELD_LIMITS[fieldName]) return false;
  return fieldName === 'official_name' || fieldName === 'source_name'
    ? !/[\u0000-\u001f\u007f]/.test(value)
    : !/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}
