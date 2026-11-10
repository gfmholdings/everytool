import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { addClip, deleteClip, startupState } from '../src/lib/clips.ts';
import { toCents, splitBill } from '../src/lib/money.ts';
import { checkLink } from '../src/lib/linkCheck.ts';
import { parsePageSpec } from '../src/lib/pages.ts';
import { measureSources } from '../src/lib/imageSources.ts';
import { sharedPdfSources } from '../src/lib/shareRouting.ts';
import { collectPages } from '../src/lib/pagination.ts';

test('cold-launch recovery respects keyboard deletions and only migrates a missing shared vault', () => {
  const local = addClip({ clips: [], qrHistory: [], countdowns: [] }, 'private clip', 1, 'a').state;
  local.qrHistory = [{ id: 'qr', direction: 'made', kind: 'Text', payload: 'private', createdAt: 1 }];
  local.countdowns = [{ id: 'cd', title: 'Private', date: 1, createdAt: 1 }];
  const shared = { ...deleteClip(local, 'a'), qrHistory: [], countdowns: [] };
  assert.deepEqual(startupState(shared, local), { clips: [], qrHistory: [], countdowns: [] });
  assert.equal(startupState(null, local), local, 'legacy fallback still migrates');
  assert.deepEqual(startupState(null, null), shared);
});

test('decimal rounding handles ties and exponent notation without losing allocated cents', () => {
  for (const [amount, cents] of [[1.005, 101], [2.675, 268], [0.005, 1], [1e-7, 0], [1e3, 100000]]) {
    assert.equal(toCents(amount!), cents);
  }
  for (const amount of [NaN, Infinity, -1, Number.MAX_VALUE]) assert.equal(toCents(amount), 0);
  const bill = splitBill(1.005, 0, 0, 3);
  assert.equal(bill.grandCents, 101);
  assert.equal(bill.sharesCents.reduce((a, b) => a + b, 0), 101);
});

test('QR warnings operate on canonical destinations and reject malformed addresses', () => {
  for (const address of ['https://0x7f000001/', 'https://2130706433/', 'https://127.1/']) {
    const result = checkLink(address);
    assert.equal(result.host, '127.0.0.1');
    assert.ok(result.warnings.some((w) => w.includes('IP address')));
  }
  assert.equal(checkLink('https://%65xample.com/').host, 'example.com');
  assert.equal(checkLink('https://[::1]/').risky, true);
  assert.equal(checkLink('https://example.com:invalid/').kind, 'other');
  assert.equal(checkLink('https://').risky, true);
  assert.equal(checkLink('https://example.com/').risky, false);
});

test('PDF ranges clamp before iteration, including reversed and unsafe ranges', () => {
  // Isolate the timeout so a regression cannot freeze the entire test runner.
  const source = new URL('../src/lib/pages.ts', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e',
    `import {parsePageSpec} from ${JSON.stringify(source)}; console.log(JSON.stringify(parsePageSpec('1-1000000000', 3)));`],
    { timeout: 3000, encoding: 'utf8' });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0);
  assert.equal(child.stdout.trim(), '[1,2,3]');
  assert.deepEqual(parsePageSpec('1000000000-1', 3), [1, 2, 3]);
  assert.deepEqual(parsePageSpec('9007199254740992-9007199254740999,2', 3), [2]);
  assert.deepEqual(parsePageSpec('1-3', Infinity), []);
  assert.deepEqual(parsePageSpec('1-3', 0), []);
});

test('a failed shared-image measurement is not retried endlessly', async () => {
  const sources = [{ uri: 'missing.png', width: 0, height: 0 }, { uri: 'good.png', width: 100, height: 200 }];
  let attempts = 0;
  const measure = async () => { attempts += 1; return { width: 0, height: 0 }; };
  const first = await measureSources(sources, measure);
  assert.equal(first[0]?.measurementFailed, true);
  await measureSources(first, measure);
  assert.equal(attempts, 1);
  assert.equal(first[1], sources[1]);
  const retry = await measureSources(sources, async () => ({ width: 20, height: 30 }));
  assert.equal(retry[0]?.width, 20, 'picking again permits recovery');
  const thrown = await measureSources(sources, async () => { throw new Error('missing'); });
  assert.equal(thrown[0]?.measurementFailed, true);
});

test('multi-PDF sharing retains both documents in inbox order', () => {
  assert.deepEqual(sharedPdfSources([
    { item: { kind: 'pdf', tool: 'pdf', file: 'one.pdf' }, uri: 'file:///one.pdf' },
    { item: { kind: 'image', tool: 'pdf', file: 'photo.png' }, uri: 'file:///photo.png' },
    { item: { kind: 'pdf', tool: 'pdf', file: 'two.pdf' }, uri: 'file:///two.pdf' },
  ]), [
    { uri: 'file:///one.pdf', name: 'one.pdf' },
    { uri: 'file:///two.pdf', name: 'two.pdf' },
  ]);
});

test('screenshot discovery follows all pages and rejects a stalled Photos cursor', async () => {
  const first = Array.from({ length: 1000 }, (_, i) => i);
  const assets = await collectPages(async (after) => after
    ? { assets: [1000, 1001], hasNextPage: false, endCursor: 'end' }
    : { assets: first, hasNextPage: true, endCursor: 'next' });
  assert.equal(assets.length, 1002);
  assert.deepEqual(assets.slice(-2), [1000, 1001]);
  await assert.rejects(collectPages(async () => ({ assets: [], hasNextPage: true, endCursor: 'stuck' })), /next page/);
});
