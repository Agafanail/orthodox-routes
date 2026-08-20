import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ configured: true, intended: true, rpc: vi.fn() }));

vi.mock('next/server', () => ({ connection: vi.fn(async () => undefined) }));
vi.mock('@/lib/supabase/config', () => ({
  getPublicSupabaseConfig: vi.fn(() => state.configured ? { key: 'public', url: 'http://local.test' } : null),
  hasPublicSupabaseConfigurationIntent: vi.fn(() => state.intended),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getClaims: vi.fn(async () => ({ data: { claims: null }, error: null })) },
    schema: () => ({ rpc: state.rpc }),
  })),
}));
vi.mock('@/components/church-transport-board', () => ({
  ChurchTransportBoard: () => <div data-testid="mock-board">mock board</div>,
}));
vi.mock('@/components/core-transport-board', () => ({
  CoreTransportBoard: () => <div data-testid="core-board">core board</div>,
}));

import ChurchPage from './page';

beforeEach(() => {
  state.configured = true;
  state.intended = true;
  state.rpc.mockReset();
  state.rpc.mockImplementation(async (name: string) => {
    if (name === 'transport_church_by_slug') return { data: {
      church_id: '00000000-0000-4000-8000-000000000001', slug: 'pokrov-catanzaro',
      official_name: 'Server Church', address: 'Server address', locality: 'Catanzaro',
      country_code: 'IT', timezone: 'Europe/Rome',
    }, error: null };
    if (name === 'list_active_passenger_requests' || name === 'list_active_driver_occurrences') {
      return { data: [], error: null };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  });
});

describe('church transport source cutover', () => {
  it('mounts only the RPC-backed Core board when Supabase is configured', async () => {
    const html = renderToStaticMarkup(await ChurchPage({
      params: Promise.resolve({ slug: 'pokrov-catanzaro' }), searchParams: Promise.resolve({}),
    }));
    expect(html).toContain('data-testid="core-board"');
    expect(html).not.toContain('data-testid="mock-board"');
    expect(html).toContain('Server Church');
    expect(html).toContain('Server address');
  });

  it('keeps the historical browser board only in explicitly unconfigured mode', async () => {
    state.configured = false;
    state.intended = false;
    const html = renderToStaticMarkup(await ChurchPage({
      params: Promise.resolve({ slug: 'pokrov-catanzaro' }), searchParams: Promise.resolve({}),
    }));
    expect(html).toContain('data-testid="mock-board"');
    expect(html).not.toContain('data-testid="core-board"');
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('fails closed instead of mounting browser state for partial configuration', async () => {
    state.configured = false;
    const html = renderToStaticMarkup(await ChurchPage({
      params: Promise.resolve({ slug: 'pokrov-catanzaro' }), searchParams: Promise.resolve({}),
    }));
    expect(html).toContain('Транспортная доска временно недоступна');
    expect(html).not.toContain('data-testid="mock-board"');
    expect(html).not.toContain('data-testid="core-board"');
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
