import { lookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP, type LookupFunction } from 'node:net';

const ipv4Denied = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) ipv4Denied.addSubnet(address, prefix, 'ipv4');
const ipv4All = new BlockList();
ipv4All.addSubnet('0.0.0.0', 0, 'ipv4');
const ipv4Exceptions = new BlockList();
ipv4Exceptions.addAddress('192.0.0.9', 'ipv4');
ipv4Exceptions.addAddress('192.0.0.10', 'ipv4');
const ipv6Global = new BlockList();
// IANA allocated global-unicast prefixes (registry inspected 2026-10-23).
// Unlisted space within 2000::/3 is reserved, not a public destination.
for (const [address, prefix] of [
  ['2001::', 23], ['2001:200::', 23], ['2001:400::', 23], ['2001:600::', 23],
  ['2001:800::', 22], ['2001:c00::', 23], ['2001:e00::', 23],
  ['2001:1200::', 23], ['2001:1400::', 22], ['2001:1800::', 23],
  ['2001:1a00::', 23], ['2001:1c00::', 22], ['2001:2000::', 19],
  ['2001:4000::', 23], ['2001:4200::', 23], ['2001:4400::', 23],
  ['2001:4600::', 23], ['2001:4800::', 23], ['2001:4a00::', 23],
  ['2001:4c00::', 23], ['2001:5000::', 20], ['2001:8000::', 19],
  ['2001:a000::', 20], ['2001:b000::', 20], ['2003::', 18],
  ['2400::', 12], ['2410::', 12], ['2600::', 12], ['2610::', 23],
  ['2620::', 23], ['2630::', 12], ['2800::', 12], ['2a00::', 12],
  ['2a10::', 12], ['2c00::', 12],
] as const) ipv6Global.addSubnet(address, prefix, 'ipv6');
const ipv6Denied = new BlockList();
for (const [address, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
] as const) ipv6Denied.addSubnet(address, prefix, 'ipv6');
const ipv6Exceptions = new BlockList();
for (const address of ['2001:1::1', '2001:1::2', '2001:1::3']) {
  ipv6Exceptions.addAddress(address, 'ipv6');
}
for (const [address, prefix] of [
  ['2001:3::', 32], ['2001:4:112::', 48], ['2001:20::', 28], ['2001:30::', 28],
] as const) ipv6Exceptions.addSubnet(address, prefix, 'ipv6');
const nat64 = new BlockList();
nat64.addSubnet('64:ff9b::', 96, 'ipv6');

/** Public destinations only; IPv4-mapped addresses use the same IPv4 exclusions. */
export function isPublicPushAddress(address: string): boolean {
  if (typeof address !== 'string') return false;
  const version = isIP(address);
  if (!version || address.includes('%')) return false;
  const family = version === 4 ? 'ipv4' : 'ipv6';
  if (version === 4 || ipv4All.check(address, family)) {
    return ipv4Exceptions.check(address, family) || !ipv4Denied.check(address, family);
  }
  if (nat64.check(address, 'ipv6')) {
    // WHATWG normalization turns an embedded dotted IPv4 suffix into two hextets.
    const parts = new URL(`https://[${address}]`).hostname.slice(1, -1).split(':');
    const high = parseInt(parts.at(-2) || '0', 16);
    const low = parseInt(parts.at(-1) || '0', 16);
    return isPublicPushAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return ipv6Global.check(address, 'ipv6')
    && (ipv6Exceptions.check(address, 'ipv6') || !ipv6Denied.check(address, 'ipv6'));
}

export function pushEndpoint(value: string): URL {
  if (!value || value.length > 2048 || /[\s\u0000-\u001f\u007f#]/.test(value)) {
    throw new Error('Push destination unavailable');
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Push destination unavailable'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('Push destination unavailable');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!hostname || (isIP(hostname) && !isPublicPushAddress(hostname))) {
    throw new Error('Push destination unavailable');
  }
  return url;
}

export type PushLookup = (
  hostname: string,
  callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;
const systemLookup: PushLookup = (hostname, callback) => lookup(hostname, { all: true }, callback);

/** Validate the exact records passed to the socket, with no second DNS resolution. */
export function publicPushLookup(signal: AbortSignal, resolve: PushLookup = systemLookup): LookupFunction {
  return (hostname, options, callback) => {
    let completed = false;
    const fail = () => finish(new Error('Push destination unavailable'), []);
    const finish = (error: NodeJS.ErrnoException | null, records: LookupAddress[]) => {
      if (completed) return;
      completed = true;
      signal.removeEventListener('abort', fail);
      if (error) callback(new Error('Push destination unavailable'), '', 0);
      else if (options.all) callback(null, records);
      else callback(null, records[0].address, records[0].family);
    };
    if (signal.aborted) { fail(); return; }
    signal.addEventListener('abort', fail, { once: true });
    try {
      resolve(hostname, (error, records) => {
        if (completed) return;
        if (error || !Array.isArray(records) || !records.length
          || records.some((record) => !record || !isPublicPushAddress(record.address)
            || isIP(record.address) !== record.family)) { fail(); return; }
        const family = options.family === 'IPv4' ? 4 : options.family === 'IPv6' ? 6 : Number(options.family);
        const selected = records.filter((record) => !family || record.family === family)
          .map(({ address, family }) => ({ address, family }));
        if (!selected.length) { fail(); return; }
        finish(null, selected);
      });
    } catch { fail(); }
  };
}
