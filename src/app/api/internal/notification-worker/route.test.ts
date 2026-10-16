import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  secret: vi.fn(), notifications: vi.fn(), invites: vi.fn(), schedule: vi.fn(), cleanup: vi.fn(),
}));
vi.mock('@/lib/supabase/config', () => ({ getNotificationWorkerSecret: mocks.secret }));
vi.mock('@/lib/notifications/worker', () => ({ processNotificationDeliveries: mocks.notifications }));
vi.mock('@/lib/church-admin/invite-worker', () => ({ processChurchInviteMail: mocks.invites }));
vi.mock('@/lib/church-admin/schedule-worker', () => ({ materializeChurchServiceSchedule: mocks.schedule }));
vi.mock('@/lib/church-images/cleanup-worker', () => ({ cleanupAbandonedChurchImages: mocks.cleanup }));
import { POST } from './route';

const secret = 'synthetic-worker-secret-'.repeat(2);
const request = (authorized = true) => new Request('https://synthetic.example.test/api/internal/notification-worker', {
  method: 'POST', headers: authorized ? { authorization: `Bearer ${secret}` } : {},
});

describe('scheduled notification and cleanup endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.secret.mockReturnValue(secret);
    mocks.notifications.mockResolvedValue({ configured: true, claimed: 0, failed: 0 });
    mocks.invites.mockResolvedValue({ configured: false, claimed: 0, sent: 0, failed: 0 });
    mocks.schedule.mockResolvedValue({ configured: true, created: 0, failed: 0 });
    mocks.cleanup.mockResolvedValue({ configured: true, claimed: 1, cleaned: 1, failed: 0 });
  });

  it('refuses to run cleanup without valid scheduler authentication', async () => {
    expect((await POST(request(false))).status).toBe(401);
    mocks.secret.mockReturnValue(null);
    expect((await POST(request())).status).toBe(503);
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });

  it('returns only cleanup counters alongside existing worker results', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.json()).churchImageCleanup)
      .toEqual({ configured: true, claimed: 1, cleaned: 1, failed: 0 });
    expect(mocks.notifications).toHaveBeenCalledTimes(1);
  });

  it('reports cleanup failure while preserving the other worker outcomes', async () => {
    mocks.cleanup.mockResolvedValue({ configured: true, claimed: 1, cleaned: 0, failed: 1 });
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect((await response.json()).churchSchedule).toEqual({ configured: true, created: 0, failed: 0 });
  });
});
