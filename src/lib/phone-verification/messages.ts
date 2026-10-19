export const phoneVerificationLanguages = ['de', 'en', 'it', 'ro', 'ru', 'uk'] as const;
export type PhoneVerificationLanguage = typeof phoneVerificationLanguages[number];

const templates = {
  de: (code: string) => `Orthodox Routes-Code: ${code}. Geben Sie ihn nicht weiter.`,
  en: (code: string) => `Orthodox Routes code: ${code}. Do not share it.`,
  it: (code: string) => `Codice Orthodox Routes: ${code}. Non condividerlo.`,
  ro: (code: string) => `Cod Orthodox Routes: ${code}. Nu îl comunica altor persoane.`,
  ru: (code: string) => `Код Orthodox Routes: ${code}. Не сообщайте его другим.`,
  uk: (code: string) => `Код Orthodox Routes: ${code}. Не повідомляйте його іншим.`,
} satisfies Record<PhoneVerificationLanguage, (code: string) => string>;

export function isPhoneSmsTemplate(version: unknown, language: unknown): language is PhoneVerificationLanguage {
  return (version === 1 && language === 'ru') || (version === 2 && typeof language === 'string'
    && phoneVerificationLanguages.includes(language as PhoneVerificationLanguage));
}

/** Version 1 is immutable provider-retry compatibility, not the copy for a newly created attempt. */
export function renderPhoneVerificationSms(code: unknown, version: unknown, language: unknown): string | null {
  if (typeof code !== 'string' || !/^[0-9]{6}$/.test(code) || !isPhoneSmsTemplate(version, language)) return null;
  return version === 1 ? `Код Orthodox Routes: ${code}. Действует 10 минут.` : templates[language](code);
}
