import assert from 'node:assert/strict';

/**
 * Trusted reverse-proxy parsing and client-address resolution.
 *
 * These are the pure helpers behind the system information device list: the
 * configured proxies, the header priority, and the rightmost-untrusted rule
 * for chained headers.
 */

const {
  isTrustedProxyAddress,
  normalizeTrustedProxies,
  parseTrustedProxies,
  resolveClientIp,
} = await import('../../lib/shared/proxy.js');

/* --------------------------------------------------------- normalization */

assert.deepEqual(normalizeTrustedProxies(''), []);
assert.deepEqual(normalizeTrustedProxies(' 127.0.0.1 '), ['127.0.0.1']);
assert.deepEqual(
  normalizeTrustedProxies('127.0.0.1, 10.0.0.0/8, 192.168.1.7/24'),
  ['127.0.0.1', '10.0.0.0/8', '192.168.1.0/24'],
  'IPv4 CIDRs are stored as their network address',
);
assert.deepEqual(
  normalizeTrustedProxies(['127.0.0.1', '10.0.0.0/8']),
  ['127.0.0.1', '10.0.0.0/8'],
  'the API may send an array',
);
assert.deepEqual(normalizeTrustedProxies('10.0.0.0/8, 10.0.0.1/8'), ['10.0.0.0/8'], 'duplicates collapse');
assert.deepEqual(normalizeTrustedProxies('::1, 2001:db8::/32'), ['::1', '2001:db8::/32']);
assert.deepEqual(normalizeTrustedProxies('::ffff:192.168.1.9'), ['192.168.1.9'], 'mapped IPv4 is stored as IPv4');
assert.deepEqual(normalizeTrustedProxies('[::1]/128'), ['::1/128'], 'bracket notation is accepted');
assert.deepEqual(normalizeTrustedProxies('999.1.1.1, 10.0.0.0/33, hello'), [], 'invalid entries are dropped');

// Only ASCII commas separate entries: every other separator leaves an invalid
// token so the settings request can reject the whole list.
assert.deepEqual(parseTrustedProxies('127.0.0.1，10.0.0.0/8').invalid, ['127.0.0.1，10.0.0.0/8']);
assert.deepEqual(parseTrustedProxies('127.0.0.1;10.0.0.0/8').invalid, ['127.0.0.1;10.0.0.0/8']);
assert.deepEqual(parseTrustedProxies('127.0.0.1 10.0.0.0/8').invalid, ['127.0.0.1 10.0.0.0/8']);
assert.deepEqual(parseTrustedProxies('127.0.0.1,,10.0.0.0/8').invalid, ['']);
assert.deepEqual(parseTrustedProxies('127.0.0.1,not-an-ip').invalid, ['not-an-ip']);
assert.deepEqual(
  parseTrustedProxies('127.0.0.1, 10.0.0.0/8'),
  { proxies: ['127.0.0.1', '10.0.0.0/8'], invalid: [] },
);

/* --------------------------------------------------------------- matching */

assert.equal(isTrustedProxyAddress('127.0.0.1', ['127.0.0.1']), true);
assert.equal(isTrustedProxyAddress('127.0.0.2', ['127.0.0.1']), false);
assert.equal(isTrustedProxyAddress('10.1.2.3', ['10.0.0.0/8']), true);
assert.equal(isTrustedProxyAddress('11.1.2.3', ['10.0.0.0/8']), false);
assert.equal(isTrustedProxyAddress('192.168.1.20', ['192.168.1.0/24']), true);
assert.equal(isTrustedProxyAddress('::ffff:10.1.2.3', ['10.0.0.0/8']), true);
assert.equal(isTrustedProxyAddress('2001:db8::7', ['2001:db8::/32']), true);
assert.equal(isTrustedProxyAddress('2001:db9::7', ['2001:db8::/32']), false);
assert.equal(isTrustedProxyAddress('::1', ['127.0.0.1']), false, 'families never match');
assert.equal(isTrustedProxyAddress('fe80::1%eth0', ['fe80::/10']), true, 'a link-local zone id is ignored');
assert.equal(isTrustedProxyAddress('1.2.3.4%evil', ['1.2.3.4']), false, 'a zone id on IPv4 is malformed');
assert.equal(isTrustedProxyAddress('127.0.0.1', []), false);

/* --------------------------------------------------------------- priority */

const proxy = '127.0.0.1';
const trusted = ['127.0.0.1', '10.0.0.0/8'];

// Headers are ignored unless the TCP peer itself is a trusted proxy.
assert.equal(
  resolveClientIp('203.0.113.9', { 'x-forwarded-for': '198.51.100.7' }, trusted),
  '203.0.113.9',
);
assert.equal(
  resolveClientIp('203.0.113.9', { 'cf-connecting-ip': '198.51.100.7' }, []),
  '203.0.113.9',
);

// With no usable header the proxy address is shown instead of an empty string.
assert.equal(resolveClientIp(proxy, {}, trusted), proxy);
assert.equal(resolveClientIp(proxy, { 'x-forwarded-for': 'unknown' }, trusted), proxy);
assert.equal(resolveClientIp(proxy, { 'x-forwarded-for': 'not-an-ip' }, trusted), proxy);

// Single-address headers win over chained headers; CF is the first choice.
assert.equal(
  resolveClientIp(proxy, {
    'cf-connecting-ip': '203.0.113.9',
    'x-real-ip': '203.0.113.10',
    'x-forwarded-for': '203.0.113.11',
  }, trusted),
  '203.0.113.9',
);
assert.equal(
  resolveClientIp(proxy, { 'x-real-ip': '203.0.113.10', 'x-forwarded-for': '203.0.113.11' }, trusted),
  '203.0.113.10',
);
assert.equal(resolveClientIp(proxy, { 'true-client-ip': '203.0.113.12' }, trusted), '203.0.113.12');
assert.equal(resolveClientIp(proxy, { 'fastly-client-ip': '203.0.113.13' }, trusted), '203.0.113.13');
assert.equal(resolveClientIp(proxy, { 'x-client-ip': '203.0.113.14' }, trusted), '203.0.113.14');

// A malformed higher-priority header falls through to the next one.
assert.equal(
  resolveClientIp(proxy, { 'cf-connecting-ip': 'nope', 'x-real-ip': '203.0.113.15' }, trusted),
  '203.0.113.15',
);
assert.equal(resolveClientIp(proxy, { 'x-real-ip': '203.0.113.15:443' }, trusted), '203.0.113.15');

// X-Forwarded-For: walk from the right, skipping trusted proxies, so spoofed
// left entries and internal hops do not become the displayed address.
assert.equal(
  resolveClientIp(proxy, { 'x-forwarded-for': '198.51.100.7, 203.0.113.9, 10.0.0.5' }, trusted),
  '203.0.113.9',
);
assert.equal(
  resolveClientIp(proxy, { 'x-forwarded-for': '198.51.100.7, 10.0.0.5' }, trusted),
  '198.51.100.7',
);
assert.equal(
  resolveClientIp(proxy, { 'x-forwarded-for': '10.0.0.5, 10.0.0.6' }, trusted),
  '10.0.0.5',
  'when every hop is trusted, the leftmost address is the client',
);
assert.equal(
  resolveClientIp(proxy, { 'x-forwarded-for': '198.51.100.7, [2001:db8::9]:443' }, trusted),
  '2001:db8::9',
);
assert.equal(
  resolveClientIp(proxy, { 'x-forwarded-for': '198.51.100.7, bogus, 10.0.0.5' }, trusted),
  '198.51.100.7',
);

// Array-valued headers are flattened in order.
assert.equal(
  resolveClientIp(proxy, { 'x-forwarded-for': ['198.51.100.7, 10.0.0.5'] }, trusted),
  '198.51.100.7',
);

// RFC 7239 Forwarded: quoted values, ports, and IPv6 brackets are accepted.
assert.equal(
  resolveClientIp(proxy, { forwarded: 'for=198.51.100.7;proto=http, for=10.0.0.5' }, trusted),
  '198.51.100.7',
);
assert.equal(
  resolveClientIp(proxy, { forwarded: 'for="[2001:db8::9]:4711";proto=https' }, trusted),
  '2001:db8::9',
);
assert.equal(
  resolveClientIp(proxy, { forwarded: 'for=_hidden, for=203.0.113.9' }, trusted),
  '203.0.113.9',
);

// X-Forwarded-For takes precedence over Forwarded.
assert.equal(
  resolveClientIp(proxy, {
    'x-forwarded-for': '198.51.100.7',
    forwarded: 'for=198.51.100.8',
  }, trusted),
  '198.51.100.7',
);

// Mapped socket addresses display as plain IPv4 and still match IPv4 ranges.
assert.equal(resolveClientIp('::ffff:127.0.0.1', { 'x-real-ip': '203.0.113.9' }, trusted), '203.0.113.9');

console.log('proxy: trusted ranges, header priority, and forwarded chains OK');
