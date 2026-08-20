import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    schema: () => ({ rpc }),
  })),
}));

vi.mock('../actions', () => ({
  cancelContextualDraftAction: vi.fn(),
  createContextualAccountAction: vi.fn(),
  declareContextualAdultAction: vi.fn(),
  requestContextualPhoneVerificationAction: vi.fn(),
  verifyContextualPhoneAction: vi.fn(),
}));

import RegistrationPage from './page';

const draftId = '9b11b924-53fa-4b86-8194-d960f8f9db89';
const draft = {
  action_type: 'passenger_request',
  draft_id: draftId,
  eligibility: {
    account_exists: false,
    current_terms_version: null,
    eligible: false,
  },
  payload: {
    churchName: 'Храм Покрова',
    passengerCount: 2,
    privateInternalValue: 'must not render',
    serviceDate: '2026-08-23',
    serviceId: 'internal-service-id',
    serviceName: 'Литургия, 23.08.2026',
  },
  registration_profile: {
    display_name: 'Анна',
    phone: '+390000000123',
    preferred_language: 'ru',
  },
  status: 'claimed',
};

beforeEach(() => {
  rpc.mockReset();
});

describe('contextual registration final review', () => {
  it('shows an owned saved action and requires explicit account completion', async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === 'current_contextual_draft') return { data: draft, error: null };
      if (name === 'current_account') return { data: null, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    });

    const html = renderToStaticMarkup(await RegistrationPage({
      params: Promise.resolve({ draftId }),
      searchParams: Promise.resolve({}),
    }));

    expect(html).toContain('Финальная проверка');
    expect(html).toContain('Запрос места');
    expect(html).toContain('Храм Покрова');
    expect(html).toContain('Литургия, 23.08.2026');
    expect(html).not.toContain('internal-service-id');
    expect(html).not.toContain('2026-08-23');
    expect(html).toContain('Подтверждение email само ничего не публикует');
    expect(html).toContain('Сохранить профиль');
    expect(html).toContain('value="Анна"');
    expect(html).toContain('value="+390000000123"');
    expect(html).not.toContain('must not render');
    expect(html).not.toContain('Опубликовать');
  });

  it('shows authoritative remaining checks without offering Terms acceptance before legal content exists', async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === 'current_contextual_draft') {
        return {
          data: {
            ...draft,
            eligibility: { ...draft.eligibility, account_exists: true },
          },
          error: null,
        };
      }
      if (name === 'current_account') {
        return {
          data: {
            adult_declared_at: null,
            display_name: 'Мария',
            email: 'maria@example.org',
            phone: '+390000000000',
            phone_verified_at: null,
          },
          error: null,
        };
      }
      if (name === 'current_phone_verification') return { data: null, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    });

    const html = renderToStaticMarkup(await RegistrationPage({
      params: Promise.resolve({ draftId }),
      searchParams: Promise.resolve({ status: 'account-created' }),
    }));

    expect(html).toContain('Профиль сохранён');
    expect(html).toContain('Мне уже исполнилось 18 лет');
    expect(html).toContain('Получить код по SMS');
    expect(html).toContain('Актуальные Условия участия ещё не опубликованы');
    expect(html).not.toContain('Принять Условия');
    expect(html).toContain('Кнопка отправки появится только после');
  });
});
