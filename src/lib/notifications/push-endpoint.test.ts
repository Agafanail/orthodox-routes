import { describe, expect, it, vi } from 'vitest';
import { isPublicPushAddress, publicPushLookup, pushEndpoint, type PushLookup } from './push-endpoint';

describe('Web Push connection destinations', () => {
  it.each([
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254',
    '172.16.0.1', '192.0.0.1', '192.0.2.1', '192.88.99.2', '192.168.1.1',
    '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', 'fc00::1', 'fe80::1', 'ff02::1', 'fe80::1%eth0',
    '::ffff:127.0.0.1', '::ffff:a9fe:a9fe', '2001::1', '2001:2::1',
    '2001:db8::1', '2002:a9fe:a9fe::1', '3fff::1', '5f00::1',
    '64:ff9b::a9fe:a9fe', '64:ff9b::127.0.0.1', '64:ff9b:1::808:808',
    '2000::1', '2001:1000::1', '2001:11ff:ffff:ffff:ffff:ffff:ffff:ffff',
    '2001:4e00::1', '2001:6000::1', '2001:c000::1', '2003:4000::1',
    '2004::1', '2420::1', '2610:200::1', '261f::1', '2620:200::1',
    '2640::1', '2810::1', '2a20::1', '2c10::1', '2d00::1', '2e00::1',
    '3000::1', '3800::1', '3c00::1', '3e00::1', '3f00::1', '3f80::1',
    '3fc0::1', '3fe0::1', '3ff0::1', '3ffe::1',
    'not-an-ip', '',
  ])('refuses non-public address %s', (address) => {
    expect(isPublicPushAddress(address)).toBe(false);
  });

  it.each([
    '8.8.8.8', '1.1.1.1', '192.0.0.9', '192.0.0.10', '192.31.196.1',
    '::ffff:8.8.8.8', '::ffff:c000:9', '2606:4700::1111', '2001:4860:4860::8888',
    '2001:1::1', '2001:1::2', '2001:1::3', '2001:3::1', '2001:4:112::1',
    '2001:20::1', '2001:30::1', '64:ff9b::808:808', '64:ff9b::8.8.8.8',
    '2001:200::1', '2001:400::1', '2001:600::1', '2001:800::1',
    '2001:c00::1', '2001:e00::1', '2001:1200::1', '2001:1400::1',
    '2001:1800::1', '2001:1a00::1', '2001:1c00::1', '2001:2000::1',
    '2001:4000::1', '2001:4200::1', '2001:4400::1', '2001:4600::1',
    '2001:4800::1', '2001:4a00::1', '2001:4c00::1', '2001:5000::1',
    '2001:8000::1', '2001:a000::1', '2001:b000::1', '2003::1',
    '2003:3fff:ffff:ffff:ffff:ffff:ffff:ffff', '2400::1', '2410::1',
    '241f:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '2600::1', '2610::1',
    '2620::1', '2630::1', '2800::1', '2a00::1', '2a10::1', '2c00::1',
  ])('allows public address %s', (address) => {
    expect(isPublicPushAddress(address)).toBe(true);
  });

  it.each([
    'http://push.example.test/x', 'https://user:password@push.example.test/x',
    'https://push.example.test/x#fragment', 'https://push.example.test/x#', ' https://push.example.test',
    'https://push.example.test/\n', 'https://127.1/x', 'https://0x7f000001/x',
    'https://2130706433/x', 'https://[::ffff:127.0.0.1]/x',
    'https://169.254.169.254/latest/meta-data', 'https://[64:ff9b::a9fe:a9fe]/x',
    'https://[3000::1]/private', 'https://[2001:1000::1]/private',
    'https://push.example.test/' + 'x'.repeat(2048), 'invalid',
  ])('rejects unsafe endpoint %s', (endpoint) => {
    expect(() => pushEndpoint(endpoint)).toThrow();
  });

  it('retains public standard endpoints, custom HTTPS ports and capability paths', () => {
    expect(pushEndpoint('https://PUSH.example.test:8443/capability?key=opaque').href)
      .toBe('https://push.example.test:8443/capability?key=opaque');
    expect(pushEndpoint('https://[2606:4700::1111]/x').hostname).toBe('[2606:4700::1111]');
  });

  it('hands the exact public DNS records to the socket without a second resolution', () => {
    const records = [{ address: '1.1.1.1', family: 4 }, { address: '2606:4700::1111', family: 6 }];
    const resolver = vi.fn<PushLookup>((_host, callback) => callback(null, records));
    const callback = vi.fn();
    publicPushLookup(new AbortController().signal, resolver)('push.example.test', { all: true }, callback);
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledExactlyOnceWith(null, records);
    expect(callback.mock.calls[0][1]).not.toBe(records);
  });

  it.each([
    [], [{ address: '1.1.1.1', family: 4 }, { address: '127.0.0.1', family: 4 }],
    [{ address: '127.0.0.1', family: 4 }], [{ address: '1.1.1.1', family: 6 }],
    [{ address: 'not-an-ip', family: 4 }], [{ address: undefined, family: 4 }],
    [{ address: '3000::1', family: 6 }],
    [{ address: '2606:4700::1111', family: 6 }, { address: '2001:1000::1', family: 6 }],
  ])('fails closed for empty, mixed or invalid DNS results %#', (...records) => {
    const callback = vi.fn();
    const resolver: PushLookup = (_host, done) => done(null, records as never);
    publicPushLookup(new AbortController().signal, resolver)('push.example.test', { all: true }, callback);
    expect(callback).toHaveBeenCalledExactlyOnceWith(expect.any(Error), '', 0);
  });

  it('supports both socket lookup forms and respects a requested family', () => {
    const records = [{ address: '1.1.1.1', family: 4 }, { address: '2606:4700::1111', family: 6 }];
    const resolver: PushLookup = (_host, done) => done(null, records);
    const lookup = publicPushLookup(new AbortController().signal, resolver);
    const single = vi.fn();
    lookup('push.example.test', { family: 6 }, single);
    expect(single).toHaveBeenCalledExactlyOnceWith(null, records[1].address, 6);
    const all = vi.fn();
    lookup('push.example.test', { family: 4, all: true }, all);
    expect(all).toHaveBeenCalledExactlyOnceWith(null, [records[0]]);
    const named = vi.fn();
    lookup('push.example.test', { family: 'IPv6', all: true }, named);
    expect(named).toHaveBeenCalledExactlyOnceWith(null, [records[1]]);
    const absent = vi.fn();
    lookup('push.example.test', { family: 5 }, absent);
    expect(absent).toHaveBeenCalledExactlyOnceWith(expect.any(Error), '', 0);
  });

  it('settles stalled DNS on abort and ignores late or duplicate callback results', () => {
    let complete: Parameters<PushLookup>[1] | undefined;
    const controller = new AbortController();
    const callback = vi.fn();
    publicPushLookup(controller.signal, (_host, done) => { complete = done; })(
      'push.example.test', { all: true }, callback,
    );
    controller.abort();
    complete!(null, [{ address: '1.1.1.1', family: 4 }]);
    complete!(null, [{ address: '127.0.0.1', family: 4 }]);
    expect(callback).toHaveBeenCalledExactlyOnceWith(expect.any(Error), '', 0);
  });

  it('does not start DNS after abort and contains resolver failures', () => {
    const controller = new AbortController();
    controller.abort();
    const resolver = vi.fn();
    const callback = vi.fn();
    publicPushLookup(controller.signal, resolver)('push.example.test', {}, callback);
    expect(resolver).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledExactlyOnceWith(expect.any(Error), '', 0);
    for (const failing of [
      () => { throw new Error('private resolver error'); },
      (_host: string, done: Parameters<PushLookup>[1]) => done(new Error('private DNS'), []),
    ]) {
      const failed = vi.fn();
      publicPushLookup(new AbortController().signal, failing)('push.example.test', {}, failed);
      expect(failed).toHaveBeenCalledExactlyOnceWith(new Error('Push destination unavailable'), '', 0);
    }
  });
});
