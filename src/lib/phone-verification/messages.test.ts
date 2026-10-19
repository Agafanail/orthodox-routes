import { describe, expect, it } from 'vitest';
import { isPhoneSmsTemplate, phoneVerificationLanguages, renderPhoneVerificationSms } from './messages';

describe('frozen phone SMS templates', () => {
  it.each(phoneVerificationLanguages)('renders one bounded neutral %s code without a fabricated lifetime', (language) => {
    const text = renderPhoneVerificationSms('012345', 2, language)!;
    expect(text).toContain('Orthodox Routes'); expect(text.match(/012345/g)).toHaveLength(1);
    expect(text.length).toBeLessThanOrEqual(70);
    expect(text).not.toMatch(/[\r\n<>@{}]/);
    expect(text.replace('012345', '')).not.toMatch(/\d/);
    expect(renderPhoneVerificationSms('012345', 2, language)).toBe(text);
    expect(isPhoneSmsTemplate(2, language)).toBe(true);
  });
  it('keeps the exact legacy Russian provider payload', () => {
    expect(renderPhoneVerificationSms('123456', 1, 'ru')).toBe('Код Orthodox Routes: 123456. Действует 10 минут.');
    for (const language of ['en', 'de', 'it', 'ro', 'uk']) expect(renderPhoneVerificationSms('123456', 1, language)).toBeNull();
  });
  it.each(['fr', 'RU', '__proto__', 'constructor', '', null, undefined])('rejects unsupported language %s without fallback', (language) => {
    expect(renderPhoneVerificationSms('123456', 2, language)).toBeNull();
  });
  it.each([0, 3, '2', null, undefined])('rejects unknown template version %s', (version) => {
    expect(renderPhoneVerificationSms('123456', version, 'en')).toBeNull();
  });
  it.each(['12345', '1234567', '12\n345', 'abcdef', 123456, null])('rejects invalid code %s', (code) => {
    expect(renderPhoneVerificationSms(code, 2, 'ru')).toBeNull();
  });
});
