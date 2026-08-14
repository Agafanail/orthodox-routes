import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../actions', () => ({
  confirmEmailAction: vi.fn(),
}));

import { confirmEmailAction } from '../actions';
import ConfirmationPage from './page';

const VALID_TOKEN_HASH = 'b'.repeat(64);

describe('confirmation page GET rendering', () => {
  it('renders the explicit confirmation action without consuming the token', async () => {
    const page = await ConfirmationPage({
      searchParams: Promise.resolve({
        next: '/auth',
        token_hash: VALID_TOKEN_HASH,
        type: 'email',
      }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain('Подтвердить вход');
    expect(html).toContain('Чтобы завершить вход, нажмите кнопку ниже.');
    expect(html).not.toContain('Ссылка ещё не использована');
    expect(html).not.toContain('Одноразовая ссылка');
    expect(html).toContain('>Войти<');
    expect(html).toContain(`value="${VALID_TOKEN_HASH}"`);
    expect(confirmEmailAction).not.toHaveBeenCalled();
  });

  it('can be rendered again like a refresh without consuming the token', async () => {
    const props = {
      searchParams: Promise.resolve({
        next: '/auth',
        token_hash: VALID_TOKEN_HASH,
        type: 'email',
      }),
    };

    renderToStaticMarkup(await ConfirmationPage(props));
    renderToStaticMarkup(await ConfirmationPage(props));

    expect(confirmEmailAction).not.toHaveBeenCalled();
  });

  it('fails safely for missing or malformed parameters', async () => {
    const page = await ConfirmationPage({
      searchParams: Promise.resolve({ token_hash: 'short', type: 'email' }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain('Не удалось войти');
    expect(html).toContain('Ссылка могла устареть или уже быть использована.');
    expect(html).toContain('Получить новую ссылку');
    expect(html).toContain('href="/auth"');
    expect(html).not.toContain('name="token_hash"');
    expect(confirmEmailAction).not.toHaveBeenCalled();
  });
});
