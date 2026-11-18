/**
 * @jest-environment node
 *
 * Loads background.js in a sandbox with a fake chrome API and fetch, and checks that registry
 * lookups are cached (including "not found"), shared while in flight, and paused after a 429.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

// Any chrome.* path is a no-op function, except storage.local, which is an in-memory store.
function fakeChrome(store) {
  const local = {
    get: async (keys) => {
      if (keys === null) return { ...store };
      const out = {};
      for (const k of [].concat(keys)) if (k in store) out[k] = store[k];
      return out;
    },
    set: async (items) => { Object.assign(store, JSON.parse(JSON.stringify(items))); },
    remove: async (keys) => { for (const k of [].concat(keys)) delete store[k]; }
  };
  const noop = new Proxy(function () {}, {
    get: (target, prop) => (prop === 'then' ? undefined : noop),
    apply: () => undefined
  });
  return new Proxy({}, {
    get: (target, prop) => (prop === 'storage' ? { local } : noop)
  });
}

function response(status, body = {}) {
  return { status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) };
}

function load({ store = {}, handler }) {
  const calls = [];
  const fetch = jest.fn(async (url, opts) => {
    calls.push(url);
    return handler(url, opts);
  });
  const context = {
    chrome: fakeChrome(store), fetch, console: { log() {}, warn() {}, error() {} },
    crypto: { randomUUID: () => 'id' }, setTimeout, clearTimeout, URL, Date, Math, JSON, Promise
  };
  vm.createContext(context);
  vm.runInContext(SOURCE, context);
  return { ctx: context, calls, store };
}

const accountDoc = { fields: { handle: { stringValue: '@bot' }, manual_reports: { integerValue: '3' }, shield_type: { stringValue: 'red' } } };
const lookups = (calls, fragment) => calls.filter((u) => u.includes(fragment)).length;

describe('background registry lookups', () => {
  test('checkSlopAccount reads Firestore once, then serves from cache', async () => {
    const { ctx, calls } = load({ handler: () => response(200, accountDoc) });
    const first = await ctx.checkSlopAccount('@Bot');
    const second = await ctx.checkSlopAccount('@bot');
    expect(first).toEqual({ handle: '@bot', manual_reports: 3, shield_type: 'red' });
    expect(second).toEqual(first);
    expect(lookups(calls, 'slop_accounts/bot')).toBe(1);
  });

  test('"not found" is cached too, and persisted to storage', async () => {
    const { ctx, calls, store } = load({ handler: () => response(404) });
    expect(await ctx.checkSuspiciousAccount('@human')).toBeNull();
    expect(await ctx.checkSuspiciousAccount('@human')).toBeNull();
    expect(lookups(calls, 'suspicious_accounts/human')).toBe(1);
    expect(store.susp_human).toEqual({ data: null, timestamp: expect.any(Number) });
  });

  test('a fresh worker reuses what an earlier one stored', async () => {
    const store = { acct_bot: { data: { handle: '@bot', manual_reports: 1, shield_type: 'blue' }, timestamp: Date.now() } };
    const { ctx, calls } = load({ store, handler: () => response(200, accountDoc) });
    expect((await ctx.checkSlopAccount('@bot')).shield_type).toBe('blue');
    expect(calls.length).toBe(0);
  });

  test('expired entries are fetched again', async () => {
    const store = { acct_bot: { data: null, timestamp: Date.now() - 3 * 60 * 60 * 1000 } };
    const { ctx, calls } = load({ store, handler: () => response(200, accountDoc) });
    expect((await ctx.checkSlopAccount('@bot')).shield_type).toBe('red');
    expect(lookups(calls, 'slop_accounts/bot')).toBe(1);
  });

  test('simultaneous lookups for the same account share one request', async () => {
    const { ctx, calls } = load({ handler: () => response(200, accountDoc) });
    await Promise.all([ctx.checkSlopAccount('@bot'), ctx.checkSlopAccount('@bot'), ctx.checkSlopAccount('@bot')]);
    expect(lookups(calls, 'slop_accounts/bot')).toBe(1);
  });

  test('after a 429 no lookups are sent, and the failure is not cached as "not found"', async () => {
    const { ctx, calls, store } = load({ handler: () => response(429) });
    expect(await ctx.checkRegistry('123')).toBeNull();
    expect(store.cache_123).toBeUndefined();
    expect(store.firestoreBackoff.until).toBeGreaterThan(Date.now());

    await ctx.checkRegistry('456');
    await ctx.checkSlopAccount('@bot');
    await ctx.checkSuspiciousAccount('@bot');
    await ctx.getImageRegistry(['media_abc']);
    expect(calls.length).toBe(1);
  });

  test('while backing off, an expired cached value is still returned', async () => {
    const stale = { ai_score: 90, status: 'slop', upvotes: 0, downvotes: 0, author_handle: '@bot' };
    const store = {
      cache_123: { data: stale, timestamp: Date.now() - 48 * 60 * 60 * 1000 },
      firestoreBackoff: { until: Date.now() + 60000, ms: 300000 }
    };
    const { ctx, calls } = load({ store, handler: () => response(200) });
    expect(await ctx.checkRegistry('123')).toEqual(stale);
    expect(calls.length).toBe(0);
  });

  test('getImageRegistry persists results and serves them after a restart', async () => {
    const found = { name: 'projects/zero-slop/databases/(default)/documents/image_registry/media_a', fields: { checks: { integerValue: '2' }, score_sum: { integerValue: '150' } } };
    const handler = (url) => url.includes('batchGet')
      ? response(200, [{ found }, { missing: 'projects/zero-slop/databases/(default)/documents/image_registry/media_b' }])
      : response(404);
    const first = load({ handler });
    const result = await first.ctx.getImageRegistry(['media_a', 'media_b']);
    expect(Object.keys(result)).toEqual(['media_a']);
    expect(first.store.imgreg_media_b).toEqual({ data: null, timestamp: expect.any(Number) });

    const second = load({ store: first.store, handler });
    const again = await second.ctx.getImageRegistry(['media_a', 'media_b']);
    expect(again.media_a.avg).toBe(75);
    expect(second.calls.filter((u) => u.includes('batchGet')).length).toBe(0);
  });
});
