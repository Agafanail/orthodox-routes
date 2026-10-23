import { createECDH, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { Agent, type RequestOptions } from 'node:https';
import { createServer } from 'node:net';
import { PassThrough } from 'node:stream';
import webPush from 'web-push';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBoundedWebPushSender } from './push-transport';
import { createWebPushNotificationAdapter } from './web-push';
import type { NotificationDeliveryJob } from './adapter';

const vapid = webPush.generateVAPIDKeys();
const receiver = createECDH('prime256v1');
receiver.generateKeys();
const subscription = {
  endpoint: 'https://push.example.test/capability?private=opaque',
  keys: { p256dh: receiver.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
};
const options = {
  TTL: 86_400, urgency: 'high' as const,
  vapidDetails: { ...vapid, subject: 'mailto:push@example.test' },
};
const payload = '{"type":"generic","route":"/notifications"}';

function fakeConnection(status?: number) {
  const outgoing = Object.assign(new EventEmitter(), { destroy: vi.fn(), end: vi.fn() });
  const incoming = Object.assign(new PassThrough(), { statusCode: status, headers: {} as Record<string, string> });
  const connect = vi.fn((_url: URL, _options: RequestOptions, response: (value: IncomingMessage) => void) => {
    if (status !== undefined) outgoing.end.mockImplementation(() => {
      queueMicrotask(() => response(incoming as unknown as IncomingMessage));
    });
    return outgoing as unknown as ClientRequest;
  });
  return { connect, incoming, outgoing };
}

afterEach(() => vi.useRealTimers());

describe('bounded Web Push transport', () => {
  it('retains library encryption, VAPID, TTL and urgency without reading provider bodies', async () => {
    const { connect, incoming, outgoing } = fakeConnection(201);
    const sender = createBoundedWebPushSender(undefined, connect);
    await expect(sender(subscription, payload, options)).resolves.toEqual({
      statusCode: 201, body: '', headers: {},
    });
    const [url, requestOptions] = connect.mock.calls[0];
    expect(url.href).toBe(subscription.endpoint);
    expect(requestOptions).toMatchObject({ method: 'POST', maxHeaderSize: 16_384 });
    expect(requestOptions.agent).toBeInstanceOf(Agent);
    expect(requestOptions.signal?.aborted).toBe(true);
    expect(requestOptions.headers).toMatchObject({ TTL: 86_400, Urgency: 'high', 'Content-Encoding': 'aes128gcm' });
    expect(requestOptions.headers).toHaveProperty('Authorization');
    const body = outgoing.end.mock.calls[0][0] as Buffer;
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(body.includes(Buffer.from(payload))).toBe(false);
    expect(incoming.listenerCount('data')).toBe(0);
    expect(incoming.destroyed).toBe(true);
    expect(outgoing.destroy).toHaveBeenCalledTimes(1);
    // A never-ending response is already closed; no body or capability header is retained.
  });

  it.each([204, 299])('preserves existing successful status %i', async (status) => {
    await expect(createBoundedWebPushSender(undefined, fakeConnection(status).connect)(
      subscription, payload, options,
    )).resolves.toEqual({ statusCode: status, headers: {}, body: '' });
  });

  it.each([301, 302, 307, 400, 404, 408, 410, 429, 500])('contains status %i and never follows redirects', async (status) => {
    const { connect, incoming } = fakeConnection(status);
    incoming.headers = { location: 'https://127.0.0.1/private', 'x-private': 'provider secret' };
    const failure = await createBoundedWebPushSender(undefined, connect)(subscription, payload, options).catch((e) => e);
    expect(failure).toMatchObject({ message: 'Push provider unavailable', statusCode: status });
    expect(Object.keys(failure)).toEqual(['statusCode']);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(incoming.destroyed).toBe(true);
  });

  it('destroys a stalled request at the wall deadline even without a socket timeout event', async () => {
    vi.useFakeTimers();
    const { connect, outgoing } = fakeConnection();
    const pending = createBoundedWebPushSender(undefined, connect)(subscription, payload, options);
    const rejected = expect(pending).rejects.toThrow('Push provider unavailable');
    const agent = connect.mock.calls[0][1].agent as Agent;
    const destroyAgent = vi.spyOn(agent, 'destroy');
    await vi.advanceTimersByTimeAsync(9_999);
    expect(outgoing.destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(outgoing.destroy).toHaveBeenCalledTimes(1);
    expect(destroyAgent).toHaveBeenCalledTimes(1);
    expect(connect.mock.calls[0][1].signal?.aborted).toBe(true);
    outgoing.emit('error', new Error('late private socket error'));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('contains synchronous connection failure and asynchronous request errors', async () => {
    const connect = () => { throw new Error('private connection failure'); };
    await expect(createBoundedWebPushSender(undefined, connect)(subscription, payload, options))
      .rejects.toThrow('Push provider unavailable');
    const fixture = fakeConnection();
    const pending = createBoundedWebPushSender(undefined, fixture.connect)(subscription, payload, options);
    const rejected = expect(pending).rejects.toThrow('Push provider unavailable');
    fixture.outgoing.emit('error', new Error('private endpoint or TLS error'));
    await rejected;
    expect(fixture.outgoing.destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects literal private destinations before encryption or any connection', async () => {
    const { connect } = fakeConnection(201);
    await expect(createBoundedWebPushSender(undefined, connect)({
      endpoint: 'https://0x7f000001/private', keys: { auth: 'bad', p256dh: 'bad' },
    }, payload, options)).rejects.toThrow('Push destination unavailable');
    expect(connect).not.toHaveBeenCalled();
  });

  it('blocks DNS-to-loopback before a real native HTTPS connection reaches the listener', async () => {
    let connections = 0;
    const server = createServer((socket) => { connections++; socket.destroy(); });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Synthetic listener unavailable');
      const resolver = vi.fn((_hostname, callback) => {
        queueMicrotask(() => callback(null, [{ address: '127.0.0.1', family: 4 }]));
      });
      const sender = createBoundedWebPushSender(resolver);
      await expect(sender({ ...subscription, endpoint: `https://push.example.test:${address.port}/x` }, payload, options))
        .rejects.toThrow('Push provider unavailable');
      expect(resolver).toHaveBeenCalledTimes(1);
      expect(connections).toBe(0);
    } finally {
      await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
    }
  });

  it('wires the real bounded default into the adapter without changing preferences or failure policy', async () => {
    const config = { ...vapid, subject: options.vapidDetails.subject, keyVersion: 1 };
    const job = {
      destinationValue: 'https://169.254.169.254/private', vapidKeyVersion: 1,
      p256dhKey: subscription.keys.p256dh, authKey: subscription.keys.auth,
    } as NotificationDeliveryJob;
    const before = structuredClone(job);
    await expect(createWebPushNotificationAdapter(config).send(job, {
      push: payload, email: { html: '', text: '', subject: '' },
    })).resolves.toEqual({
      outcome: 'temporary_failure', providerAdapter: 'web-push-vapid-1', providerCode: null,
      providerReference: null, safeFailureClass: 'provider_unavailable',
    });
    expect(job).toEqual(before);
  });
});
