import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * The share sheet decides whether Everytool appears *before* any of our
 * code runs. Build 1.0.0 (11) used NSExtensionActivationSupportsImageWithMaxCount,
 * which the sheet treats as a photo (JPEG/HEIC) and does not offer for a
 * PNG. This test locks the predicate that names public.png explicitly.
 */

const plist = readFileSync(new URL('../targets/share/Info.plist', import.meta.url), 'utf8');

function activationRule(xml: string): string {
  const keyAt = xml.indexOf('<key>NSExtensionActivationRule</key>');
  assert.notEqual(keyAt, -1, 'NSExtensionActivationRule is missing');
  const after = xml.slice(keyAt);
  assert.match(after, /^<key>NSExtensionActivationRule<\/key>\s*<string>/);
  const start = after.indexOf('<string>') + '<string>'.length;
  const end = after.indexOf('</string>');
  return after.slice(start, end);
}

/** UTIs the predicate names with UTI-CONFORMS-TO, in order. */
function declaredTypes(rule: string): string[] {
  return [...rule.matchAll(/UTI-CONFORMS-TO "([^"]+)"/g)].map((m) => m[1]!);
}

const PARENTS: Record<string, string[]> = {
  'public.png': ['public.image'],
  'public.jpeg': ['public.image'],
  'public.heic': ['public.heif', 'public.image'],
  'public.heif': ['public.image'],
  'public.gif': ['public.image'],
  'public.plain-text': ['public.text'],
};

function conforms(id: string, target: string): boolean {
  if (id === target) return true;
  const seen = new Set<string>();
  const stack = [...(PARENTS[id] ?? [])];
  while (stack.length) {
    const next = stack.pop()!;
    if (next === target) return true;
    if (seen.has(next)) continue;
    seen.add(next);
    stack.push(...(PARENTS[next] ?? []));
  }
  return false;
}

function accepts(ruleTypes: string[], attachments: string[][]): boolean {
  return attachments.some(
    (item) =>
      item.length <= 20 &&
      item.some((uti) => ruleTypes.some((target) => conforms(uti, target))),
  );
}

test('share activation: PNG is named, and the photo-only dictionary key is gone', () => {
  assert.doesNotMatch(plist, /<key>NSExtensionActivationSupportsImageWithMaxCount<\/key>/);
  assert.doesNotMatch(plist, /<key>NSExtensionActivationSupportsFileWithMaxCount<\/key>/);
  const rule = activationRule(plist);
  const types = declaredTypes(rule);
  for (const required of [
    'public.png',
    'public.jpeg',
    'public.heic',
    'public.heif',
    'public.image',
    'com.adobe.pdf',
    'public.text',
    'public.plain-text',
    'public.url',
  ]) {
    assert.ok(types.includes(required), `activation rule does not name ${required}`);
  }
  // Alternatives, not a dictionary that ANDs every key together.
  assert.match(rule, /\bOR\b/);
  assert.match(rule, /@count\s*&lt;=\s*20/);
  assert.match(rule, /@count\s*&gt;=\s*1/);
});

test('share activation: PNG, HEIC, JPEG and screenshots match; a movie does not', () => {
  const types = declaredTypes(activationRule(plist));
  const yes: string[][][] = [
    [['public.png']],
    [['public.jpeg']],
    [['public.heic']],
    [['public.heif']],
    [['public.image']],
    [['public.gif']],
    [['com.adobe.pdf']],
    [['public.plain-text']],
    [['public.text']],
    [['public.url']],
    [['public.png'], ['public.jpeg']],
    [Array.from({ length: 20 }, () => 'public.png')],
  ];
  for (const item of yes) {
    assert.equal(accepts(types, item), true, JSON.stringify(item));
  }
  assert.equal(accepts(types, [['public.mpeg-4']]), false);
  assert.equal(accepts(types, [[]]), false);
  assert.equal(accepts(types, [Array.from({ length: 21 }, () => 'public.png')]), false);
  // public.png must match on its own name. A rule that only says
  // public.image is what build 11 already failed to honor for PNGs.
  assert.equal(
    types.filter((t) => t === 'public.png').length,
    1,
  );
});
