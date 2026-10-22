import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

/**
 * App Store Connect rejects NSExtensionActivationRule at 4000 characters
 * (error 90362). The share sheet reads this string before any of our code
 * runs. Broad UTI-CONFORMS-TO checks replace a list of concrete types:
 * public.png conforms to public.image, so a PNG still matches. The old
 * dictionary key NSExtensionActivationSupportsImageWithMaxCount did not.
 */

const root = new URL('..', import.meta.url).pathname;
const sourcePlist = new URL('../targets/share/Info.plist', import.meta.url);

/** App Store counts the decoded plist string, not the XML escapes. */
function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function activationRule(xml: string): string {
  const keyAt = xml.indexOf('<key>NSExtensionActivationRule</key>');
  assert.notEqual(keyAt, -1, 'NSExtensionActivationRule is missing');
  const after = xml.slice(keyAt);
  assert.match(after, /^<key>NSExtensionActivationRule<\/key>\s*<string>/);
  const start = after.indexOf('<string>') + '<string>'.length;
  const end = after.indexOf('</string>');
  return decodeXml(after.slice(start, end));
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

/**
 * The source plist, any copied Info.plist that still has the rule, and the
 * file the prebuild project actually compiles for EverytoolShare.
 */
function activationPlists(): string[] {
  const found = new Set<string>([sourcePlist.pathname]);
  for (const path of walk(join(root, 'ios'))) {
    if (!path.endsWith('Info.plist')) continue;
    const xml = readFileSync(path, 'utf8');
    if (xml.includes('<key>NSExtensionActivationRule</key>')) found.add(path);
  }
  const project = join(root, 'ios/Everytool.xcodeproj/project.pbxproj');
  if (existsSync(project)) {
    const pbx = readFileSync(project, 'utf8');
    const shareBlocks = pbx
      .split('buildSettings = {')
      .filter((block) => block.includes('app.everytool.ios.share'));
    assert.ok(shareBlocks.length >= 1, 'prebuild did not emit an EverytoolShare target');
    for (const block of shareBlocks) {
      const file = block.match(/(?:^|\n)\s*INFOPLIST_FILE = ([^;]+);/)?.[1]?.replace(/"/g, '').trim();
      assert.equal(file, '../targets/share/Info.plist');
      found.add(join(root, 'ios', file));
    }
  }
  return [...found];
}

/** UTIs the predicate names with UTI-CONFORMS-TO. */
function declaredTypes(rule: string): string[] {
  return [...rule.matchAll(/UTI-CONFORMS-TO "([^"]+)"/g)].map((m) => m[1]!);
}

/** Parents a registered type conforms to, besides itself. */
const PARENTS: Record<string, string[]> = {
  'public.png': ['public.image'],
  'public.jpeg': ['public.image'],
  'public.heic': ['public.heif', 'public.image'],
  'public.heif': ['public.image'],
  'public.gif': ['public.image'],
  'public.tiff': ['public.image'],
  'com.microsoft.bmp': ['public.image'],
  'org.webmproject.webp': ['public.image'],
  'public.mpeg-4': ['public.movie'],
  'com.apple.quicktime-movie': ['public.movie'],
  'public.plain-text': ['public.text'],
  'public.utf8-plain-text': ['public.plain-text'],
  'public.rtf': ['public.text'],
  'public.html': ['public.text'],
  'public.comma-separated-values-text': ['public.text'],
  'net.daringfireball.markdown': ['public.plain-text'],
  'public.file-url': ['public.url'],
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

const BROAD = [
  'public.image',
  'public.movie',
  'com.adobe.pdf',
  'public.plain-text',
  'public.text',
  'public.url',
  'public.file-url',
];

test('share activation rule stays under the App Store 4000-character limit', () => {
  const plists = activationPlists();
  assert.ok(plists.length >= 1);
  for (const path of plists) {
    const xml = readFileSync(path, 'utf8');
    const rule = activationRule(xml);
    const where = relative(root, path);
    assert.ok(
      rule.length < 4000,
      `${where} NSExtensionActivationRule is ${rule.length} characters`,
    );
    assert.ok(rule.length < 1500, `${where} rule is ${rule.length}, aim is under 1500`);
    assert.match(rule, /SUBQUERY\s*\(/);
    assert.doesNotMatch(xml, /<key>NSExtensionActivationSupportsImageWithMaxCount<\/key>/);
    assert.doesNotMatch(xml, /<key>NSExtensionActivationSupportsFileWithMaxCount<\/key>/);
    assert.doesNotMatch(rule, /public\.data/);
  }
});

test('share activation: broad types cover images, movies, PDFs, text, and URLs', () => {
  const rule = activationRule(readFileSync(sourcePlist, 'utf8'));
  const types = declaredTypes(rule);
  assert.deepEqual(types, BROAD);
  assert.match(rule, /\bOR\b/);
  assert.match(rule, /@count <= 20/);
  assert.match(rule, /@count >= 1/);

  const yes: string[][][] = [
    [['public.png']],
    [['public.jpeg']],
    [['public.heic']],
    [['public.heif']],
    [['public.image']],
    [['public.gif']],
    [['public.tiff']],
    [['com.microsoft.bmp']],
    [['org.webmproject.webp']],
    [['public.mpeg-4']],
    [['com.apple.quicktime-movie']],
    [['public.movie']],
    [['com.adobe.pdf']],
    [['public.plain-text']],
    [['public.utf8-plain-text']],
    [['public.text']],
    [['public.rtf']],
    [['public.html']],
    [['public.comma-separated-values-text']],
    [['net.daringfireball.markdown']],
    [['public.url']],
    [['public.file-url']],
    [['public.png'], ['public.jpeg']],
    [Array.from({ length: 20 }, () => 'public.png')],
  ];
  for (const item of yes) {
    assert.equal(accepts(types, item), true, JSON.stringify(item));
  }
  assert.equal(accepts(types, [['public.zip-archive']]), false);
  assert.equal(accepts(types, [[]]), false);
  assert.equal(accepts(types, [Array.from({ length: 21 }, () => 'public.png')]), false);
  // PNG is not spelled out. It matches because it conforms to public.image.
  assert.equal(types.includes('public.png'), false);
  assert.equal(accepts(types, [['public.png']]), true);
});
