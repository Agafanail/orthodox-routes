// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * What the catalog does with the position the browser hands it.
 *
 * The owner's manual test placed them in another country after granting location. The
 * application has no location source of its own — no address lookup, no address-based guess, no
 * default coordinate — so the only defence against a wrong position is to notice when the
 * browser itself says the position is vague, and to refuse to sort by it rather than present it
 * as fact. These tests pin that behaviour, and pin that nothing exact ever reaches the URL.
 */

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { NearMeAction } from './near-me-action';

function grantPosition(coords: { latitude: number; longitude: number; accuracy: number }) {
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (onSuccess: (position: { coords: typeof coords }) => void) => {
        onSuccess({ coords });
      },
    },
  });
}

afterEach(() => {
  cleanup();
  push.mockReset();
  vi.unstubAllGlobals();
});

describe('NearMeAction', () => {
  it('sorts by a position the browser reports as precise', async () => {
    grantPosition({ accuracy: 30, latitude: 38.90983, longitude: 16.58771 });
    render(<NearMeAction query="" />);

    fireEvent.click(screen.getByRole('button', { name: 'Рядом со мной' }));

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const target = String(push.mock.calls[0][0]);
    // Rounded to roughly a kilometre before it travels, so no exact position enters a URL,
    // a server log, or anything downstream of one.
    expect(target).toContain('lat=38.91');
    expect(target).toContain('lng=16.59');
    expect(target).not.toContain('38.90983');
    expect(target).not.toContain('16.58771');
  });

  it('refuses to sort by a position the browser reports as vague, and says how vague', async () => {
    // A position derived from the network rather than satellites arrives looking ordinary and
    // can be a country out. The browser's own accuracy is the only honest signal available.
    grantPosition({ accuracy: 180_000, latitude: 43.85, longitude: 18.41 });
    render(<NearMeAction query="" />);

    fireEvent.click(screen.getByRole('button', { name: 'Рядом со мной' }));

    const notice = await screen.findByText(/слишком приблизительно/);
    expect(notice.textContent).toContain('180 км');
    expect(push).not.toHaveBeenCalled();
  });
});
