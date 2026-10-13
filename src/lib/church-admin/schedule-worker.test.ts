import { describe, expect, it, vi } from 'vitest';
import { materializeChurchServiceSchedule } from './schedule-worker';

describe('church schedule worker', () => {
  it('uses only the privileged service RPC and reports materialized dates', async () => {
    const rpc = vi.fn(async () => ({ data: 4, error: null }));
    const client = { schema: vi.fn(() => ({ rpc })) };
    await expect(materializeChurchServiceSchedule(client)).resolves.toEqual({
      configured: true, created: 4, failed: 0,
    });
    expect(client.schema).toHaveBeenCalledWith('api');
    expect(rpc).toHaveBeenCalledWith('service_schedule_worker_materialize', {});
  });

  it('does not report success when the privileged client or RPC is unavailable', async () => {
    await expect(materializeChurchServiceSchedule(null)).resolves.toEqual({
      configured: false, created: 0, failed: 0,
    });
    const client = { schema: () => ({ rpc: async () => ({ data: null, error: { code: '42501' } }) }) };
    await expect(materializeChurchServiceSchedule(client)).resolves.toEqual({
      configured: true, created: 0, failed: 1,
    });
  });
});
