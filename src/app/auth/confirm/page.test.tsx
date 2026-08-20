import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ConfirmationPage from './page';

describe('confirmation page GET rendering', () => {
  it('renders a secret-free loading boundary without consuming the token', async () => {
    const page = await ConfirmationPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain('Проверяем ссылку');
    expect(html).not.toContain('token_hash');
    expect(html).not.toContain('name="draft"');
  });

  it('renders a safe error without accepting callback secrets in the query string', async () => {
    const page = await ConfirmationPage({
      searchParams: Promise.resolve({
        error: 'invalid-link',
        token_hash: 'must-not-be-rendered',
      }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain('Не удалось войти');
    expect(html).toContain('Ссылка могла устареть или уже быть использована.');
    expect(html).toContain('href="/auth"');
    expect(html).not.toContain('must-not-be-rendered');
  });
});
