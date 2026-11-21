import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Weather settings, provider quota cache, JWT signing, and condition mapping.
 *
 * The provider HTTP calls themselves are not exercised here; the tests cover the
 * pure seams that decide where data goes and whether a request may be made.
 */

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rc-weather-'));
process.env.DSH_PROFILE_DIR = profile;

const {
  WEATHER_PROVIDERS,
  createSettingsStore,
  minimumQWeatherRefreshMinutes,
} = await import('../../lib/settings/index.js');
const { createCacheStore, qweatherMonth } = await import('../../lib/cache/index.js');
const { generateQWeatherJwt, generateQWeatherKeyPair, parseQWeatherConsole } = await import('../../lib/weather/qweather.js');
const { resolveNmcCity } = await import('../../lib/weather/nmc.js');
const {
  mapNmcCode,
  mapQWeatherCode,
  normalizeAirQuality,
  stripRegionSuffix,
} = await import('../../lib/weather/shared.js');

/* ---------------------------------------------------------------- settings */

// A v1 document has one shared coordinate pair; it migrates to every provider
// slot while the provider itself defaults to Open-Meteo.
const settingsDir = path.join(profile, 'remote-control');
fs.mkdirSync(settingsDir, { recursive: true });
fs.writeFileSync(path.join(settingsDir, 'settings.json'), JSON.stringify({
  version: 1,
  weather: {
    mode: 'manual',
    name: '南昌',
    latitude: 28.684,
    longitude: 115.8531,
    forecastMode: 'daily',
  },
}), 'utf8');

let store = createSettingsStore();
assert.equal(store.get().version, 3);
assert.equal(store.get().weather.provider, 'open-meteo');
assert.equal(store.get().weather.name, '南昌');
for (const provider of WEATHER_PROVIDERS) {
  assert.equal(store.get().weather.locations[provider].latitude, 28.684);
  assert.equal(store.get().weather.locations[provider].longitude, 115.8531);
  assert.equal(store.get().weather.locations[provider].locationId, '');
}
assert.equal(store.get().weather.qweather.monthlyLimit, 47_500);
assert.equal(store.get().weather.qweather.refreshMinutes, 30);

// Per-provider geodata survives a provider switch. The display name is shared.
store.update({
  weather: {
    provider: 'qweather',
    name: '北京',
    locations: {
      nmc: { latitude: null, longitude: null, locationId: 'Wqsps' },
      qweather: { latitude: 39.9042, longitude: 116.4074, locationId: '101010100', timezone: 'Asia/Shanghai', country: '中国' },
    },
  },
});
assert.equal(store.get().weather.provider, 'qweather');
assert.equal(store.get().weather.name, '北京');
assert.equal(store.get().weather.locations.nmc.locationId, 'Wqsps');
assert.equal(store.get().weather.locations.qweather.locationId, '101010100');
assert.equal(store.get().weather.locations['open-meteo'].latitude, 28.684, 'untouched slot keeps its old value');

// QWeather credentials and the user's refresh interval. A low interval is
// stored exactly as entered; the quota warning is a sidebar concern.
store.update({
  weather: {
    qweather: {
      apiHost: 'https://abcxyz.qweatherapi.com/path',
      credentialId: 'kid-1',
      projectId: 'project-1',
      developerId: 'Q123456789',
      privateKey: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
      monthlyLimit: 1000,
      refreshMinutes: 5,
    },
  },
});
assert.equal(store.get().weather.qweather.apiHost, 'abcxyz.qweatherapi.com');
assert.equal(minimumQWeatherRefreshMinutes(1000), 173);
assert.equal(store.get().weather.qweather.refreshMinutes, 5, 'the user interval is kept');
store.update({ weather: { qweather: { refreshMinutes: 1 } } });
assert.equal(store.get().weather.qweather.refreshMinutes, 1, 'a one-minute interval is kept');
store.update({ weather: { qweather: { refreshMinutes: 0 } } });
assert.equal(store.get().weather.qweather.refreshMinutes, 30, 'zero falls back to the default');

// The monthly limit ceiling is the largest safe JS integer, so quota math
// never leaves the safe-integer range.
store.update({ weather: { qweather: { monthlyLimit: 1e20, refreshMinutes: 30 } } });
assert.equal(store.get().weather.qweather.monthlyLimit, Number.MAX_SAFE_INTEGER);
assert.equal(minimumQWeatherRefreshMinutes(Number.MAX_SAFE_INTEGER), 5);
assert.equal(store.get().weather.qweather.refreshMinutes, 30);
store.update({ weather: { qweather: { monthlyLimit: 1000, refreshMinutes: 30 } } });

// Public settings expose copies, not the live nested objects.
const snapshot = store.public();
snapshot.weather.locations.qweather.latitude = 0;
assert.equal(store.get().weather.locations.qweather.latitude, 39.9042);
assert.equal(store.get().weather.locations.qweather.country, '中国');

// A reload keeps the split geodata and the credential fields.
store = createSettingsStore();
assert.equal(store.get().weather.provider, 'qweather');
assert.equal(store.get().weather.locations.qweather.latitude, 39.9042);
assert.equal(store.get().weather.qweather.credentialId, 'kid-1');
assert.equal(store.get().weather.qweather.syncConsole, false);
store.update({ weather: { qweather: { syncConsole: true } } });
assert.equal(store.get().weather.qweather.syncConsole, true);

/* ------------------------------------------------------------------- cache */

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rc-cache-'));
const legacy = {
  version: 1,
  updatedAt: 1,
  apps: {
    QQ: { key: 'QQ', name: 'QQ', count: 8, lastSeen: 1 },
  },
};
fs.writeFileSync(path.join(cacheDir, 'notification-cache.json'), JSON.stringify(legacy), 'utf8');

let cache = createCacheStore(cacheDir);
assert.equal(fs.existsSync(path.join(cacheDir, 'notification-cache.json')), false, 'legacy cache is renamed');
assert.equal(fs.existsSync(path.join(cacheDir, 'cache.json')), true);
const migrated = JSON.parse(fs.readFileSync(path.join(cacheDir, 'cache.json'), 'utf8'));
assert.equal(migrated.apps.QQ.count, 8, 'legacy app history is preserved');

assert.match(qweatherMonth(), /^\d{4}-\d{2}$/u);
assert.equal(cache.weatherUsage().qweather, 0);
cache.addQWeatherCalls(3);
cache.addQWeatherCalls(2);
assert.equal(cache.weatherUsage().qweather, 5);

cache = createCacheStore(cacheDir);
assert.equal(cache.weatherUsage().qweather, 5, 'the counter survives a reload');
assert.equal(cache.weatherUsage().month, qweatherMonth());
cache.resetQWeatherUsage();
assert.equal(cache.weatherUsage().qweather, 0);

const consoleSnapshot = parseQWeatherConsole({
  asOf: '2026-11-16T08:00Z',
  availableResourcePlans: [{ status: 'active', requests: '50000', utilized: 1234 }],
}, {
  asOf: '2026-11-16T08:59Z',
  success: [{ api: 'Weather', hours: [1, 2, 3] }],
  errors: [{ api: 'Geo', hours: [0, 1] }],
}, 123);
assert.equal(consoleSnapshot.monthlyUsed, 1234);
assert.equal(consoleSnapshot.stats.success, 6);
assert.equal(consoleSnapshot.stats.errors, 1);
assert.equal(consoleSnapshot.stats.total, 7);
assert.equal(consoleSnapshot.asOf, '2026-11-16T08:00Z');
cache.setQWeatherConsole(consoleSnapshot);
assert.equal(cache.qweatherConsole().monthlyUsed, 1234);
cache = createCacheStore(cacheDir);
assert.equal(cache.qweatherConsole().monthlyUsed, 1234);

cache.setGeocode({
  latitude: 28.67,
  longitude: 115.87,
  name: '南昌',
  province: '江西省',
  country: '中国',
  source: 'reverse',
  fetchedAt: 123,
});
assert.equal(cache.geocode().name, '南昌');
cache = createCacheStore(cacheDir);
assert.equal(cache.geocode().name, '南昌');
assert.equal(cache.geocode().province, '江西省');
cache.clearGeocode();
assert.equal(cache.geocode(), null);
cache = createCacheStore(cacheDir);
assert.equal(cache.geocode(), null);

cache.setNmcCities([
  { code: 'Wqsps', city: '北京', province: '北京市', url: '' },
  { code: 'niStC', city: '昌平', province: '北京市', url: '' },
]);
assert.equal(cache.nmcCities().cities.length, 2);
cache = createCacheStore(cacheDir);
assert.equal(cache.nmcCities().cities[0].code, 'Wqsps');

/* --------------------------------------------------------------------- JWT */

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const generated = generateQWeatherJwt({
  credentialId: 'kid-1',
  projectId: 'project-1',
  developerId: 'Q123456789',
  privateKey: privatePem,
});
const [encodedHeader, encodedPayload, encodedSignature] = generated.token.split('.');
const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
assert.equal(header.alg, 'EdDSA');
assert.equal(header.kid, 'kid-1');
assert.equal(payload.iss, 'Q123456789');
assert.equal(payload.sub, 'project-1');
assert.equal(payload.exp - payload.iat, 3600);
assert.equal(generated.exp, payload.exp);
assert.equal(
  crypto.verify(
    null,
    Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8'),
    crypto.createPublicKey(publicPem),
    Buffer.from(encodedSignature, 'base64url'),
  ),
  true,
);

assert.throws(() => generateQWeatherJwt({
  credentialId: '',
  projectId: 'project-1',
  developerId: 'Q123456789',
  privateKey: privatePem,
}), /credential id/u);
assert.throws(() => generateQWeatherJwt({
  credentialId: 'kid-1',
  projectId: 'project-1',
  developerId: 'Q123456789',
  privateKey: 'not a key',
}), /valid PEM/u);

const keyPair = generateQWeatherKeyPair();
assert.match(keyPair.privateKey, /BEGIN PRIVATE KEY/u);
assert.match(keyPair.publicKey, /BEGIN PUBLIC KEY/u);
assert.equal(crypto.createPrivateKey(keyPair.privateKey).asymmetricKeyType, 'ed25519');
assert.equal(crypto.createPublicKey(keyPair.publicKey).asymmetricKeyType, 'ed25519');

/* ------------------------------------------------------------------ mapping */

assert.equal(mapQWeatherCode(100), 0);
assert.equal(mapQWeatherCode(104), 3);
assert.equal(mapQWeatherCode(305), 61);
assert.equal(mapQWeatherCode(402), 75);
assert.equal(mapQWeatherCode(502), 45);
assert.equal(mapNmcCode(0, '晴'), 0);
assert.equal(mapNmcCode(7, '小雨'), 61);
assert.equal(mapNmcCode(9999, '阴'), 3);

const aqi = normalizeAirQuality(42, '42', '1', '优', 'PM2.5');
assert.equal(aqi.level, 1);
assert.equal(aqi.display, '42');
assert.equal(normalizeAirQuality(180, null, null, null).level, 4);
assert.equal(normalizeAirQuality(null), null);

assert.equal(stripRegionSuffix('江西省'), '江西');
assert.equal(stripRegionSuffix('北京市'), '北京');
assert.equal(stripRegionSuffix('南昌市'), '南昌');

const fakeCache = {
  nmcCities: () => ({
    fetchedAt: Date.now(),
    cities: [
      { code: 'Wqsps', city: '北京', province: '北京市', url: '' },
      { code: 'niStC', city: '昌平', province: '北京市', url: '' },
    ],
  }),
};
const nmcMatch = await resolveNmcCity('北京', '北京市', fakeCache, {});
assert.equal(nmcMatch.code, 'Wqsps');

fs.rmSync(profile, { recursive: true, force: true });
fs.rmSync(cacheDir, { recursive: true, force: true });
console.log('weather: settings migration, cache, JWT, and condition mapping OK');
