// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailEntry } from './email-entry';

afterEach(cleanup);

function renderEntry(
  requestAction = vi.fn(async (_previousState, formData: FormData) => ({
    email: String(formData.get('email')),
    status: 'sent' as const,
  })),
) {
  render(
    <EmailEntry
      configured
      initialError={null}
      requestAction={requestAction}
      signedOut={false}
    />,
  );
  return requestAction;
}

describe('email entry completed state', () => {
  it('replaces the form after a successful request and includes the submitted email', async () => {
    const requestAction = renderEntry();
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
      target: { value: 'person@example.org' },
    });

    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Получить ссылку для входа' }).closest('form')!);
    });

    expect(requestAction).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Проверьте почту' }));
    expect(screen.getByRole('status').textContent).toBe(
      'Мы отправили ссылку для входа на person@example.org. Откройте письмо и перейдите по ссылке.',
    );
    expect(screen.queryByRole('textbox', { name: 'Email' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Получить ссылку для входа' })).toBeNull();
  });

  it('shows a dedicated human state for the structured resend throttle', async () => {
    renderEntry(vi.fn(async () => ({ status: 'rate-limited' as const })));

    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Получить ссылку для входа' }).closest('form')!);
    });

    expect(screen.getByRole('heading', { name: 'Ссылка уже отправлена' })).toBe(
      document.activeElement,
    );
    expect(screen.getByRole('status').textContent).toBe(
      'Мы недавно отправили ссылку на этот email. Проверьте почту или попробуйте отправить её ещё раз через минуту.',
    );
    expect(document.body.textContent).not.toContain('429');
    expect(document.body.textContent).not.toContain('rate');
    expect(document.body.textContent).not.toContain('Supabase');
  });

  it('keeps unrelated provider failures generic and hides technical details', async () => {
    renderEntry(vi.fn(async () => ({ status: 'send-failed' as const })));

    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Получить ссылку для входа' }).closest('form')!);
    });

    expect(screen.getByRole('heading', { name: 'Не удалось отправить ссылку' })).toBe(
      document.activeElement,
    );
    expect(screen.getByRole('alert').textContent).toBe('Попробуйте ещё раз позже.');
    expect(document.body.textContent).not.toContain('raw provider detail');
    expect(document.body.textContent).not.toContain('over_email_send_rate_limit');
  });

  it('restores and focuses the email form when another email is requested', async () => {
    renderEntry();
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
      target: { value: 'person@example.org' },
    });

    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Получить ссылку для входа' }).closest('form')!);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Указать другой email' }));

    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Email' }));
    expect(
      screen.getByRole('button', { name: 'Получить ссылку для входа' }).hasAttribute('disabled'),
    ).toBe(false);
    expect(screen.queryByRole('heading', { name: 'Проверьте почту' })).toBeNull();
  });
});
