import { createPrivilegedSupabaseClient } from '@/lib/supabase/server-privileged';

type RpcResult = { data: unknown; error: unknown };
type ScheduleWorkerClient = {
  schema(name: 'api'): {
    rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
  };
};

export async function materializeChurchServiceSchedule(
  client: ScheduleWorkerClient | null = createPrivilegedSupabaseClient() as ScheduleWorkerClient | null,
) {
  if (!client) return { configured: false, created: 0, failed: 0 };
  const result = await client.schema('api').rpc('service_schedule_worker_materialize', {});
  if (result.error || typeof result.data !== 'number' || !Number.isInteger(result.data)
    || result.data < 0) return { configured: true, created: 0, failed: 1 };
  return { configured: true, created: result.data, failed: 0 };
}
