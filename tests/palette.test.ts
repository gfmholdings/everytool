import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

import { INK_BLACK, INK_BLUE } from '../src/lib/pdfSign.ts';
import { DEFAULT_QR_STYLE } from '../src/lib/qrHistory.ts';
import { contrastRatio, dark, documentInk, light, type Palette } from '../src/theme.ts';

const root = new URL('..', import.meta.url).pathname;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const HEX = /#[0-9A-Fa-f]{3,8}\b/g;

function isColorHex(token: string): boolean {
  const digits = token.slice(1);
  return digits.length === 3 || digits.length === 4 || digits.length === 6 || digits.length === 8;
}

test('text and UI contrast meet WCAG AA in light and dark', () => {
  const check = (name: string, p: Palette) => {
    const text = (fg: string, bg: string) => {
      const ratio = contrastRatio(fg, bg);
      assert.ok(ratio >= 4.5, `${name} ${fg} on ${bg} is ${ratio.toFixed(2)}, need 4.5`);
    };
    const ui = (fg: string, bg: string) => {
      const ratio = contrastRatio(fg, bg);
      assert.ok(ratio >= 3, `${name} ${fg} on ${bg} is ${ratio.toFixed(2)}, need 3`);
    };
    text(p.textPrimary, p.background);
    text(p.textPrimary, p.surface);
    text(p.textSecondary, p.background);
    text(p.textSecondary, p.surface);
    text(p.primary, p.background);
    text(p.primary, p.surface);
    text(p.onPrimary, p.primary);
    text(p.onSecondary, p.secondary);
    text(p.destructive, p.background);
    text(p.destructive, p.surface);
    text(p.onDestructive, p.destructive);
    text(p.success, p.background);
    text(p.success, p.surface);
    text(p.warning, p.background);
    text(p.warning, p.surface);
    text(p.onToast, p.toast);
    text(p.onMedia, p.media);
    text(p.onMedia, p.mediaRaised);
    ui(p.separator, p.background);
    ui(p.separator, p.surface);
    ui(p.primary, p.background);
  };
  check('light', light);
  check('dark', dark);
  assert.equal(light.primary === dark.primary, false);
});

test('the Swift palette uses the same bytes as the token file', () => {
  const swift = readFileSync(new URL('../targets/_shared/Palette.swift', import.meta.url), 'utf8');
  const hex = (value: string) => {
    const wide =
      value.length === 4
        ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
        : value;
    const n = Number.parseInt(wide.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  for (const key of Object.keys(light) as (keyof Palette)[]) {
    const lightValue = light[key];
    const darkValue = dark[key];
    if (lightValue.startsWith('rgba') || darkValue.startsWith('rgba')) continue;
    const [lr, lg, lb] = hex(lightValue);
    const [dr, dg, db] = hex(darkValue);
    const line = `static let ${key} = dynamic(light: ui(${lr}, ${lg}, ${lb}), dark: ui(${dr}, ${dg}, ${db}))`;
    assert.ok(swift.includes(line), `Palette.swift missing ${key}`);
  }
});

test('raw hex colors live only in the token file', () => {
  const allow = new Set([relative(root, new URL('../src/theme.ts', import.meta.url).pathname)]);
  const offenders: string[] = [];
  for (const path of walk(root)) {
    if (!/\.(ts|tsx|swift)$/.test(path)) continue;
    const rel = relative(root, path);
    if (rel.startsWith('tests/') || rel.startsWith('node_modules/')) continue;
    if (allow.has(rel)) continue;
    const text = readFileSync(path, 'utf8');
    const found = text.match(HEX)?.filter(isColorHex) ?? [];
    if (found.length > 0) offenders.push(`${rel}: ${found.join(', ')}`);
    if (rel !== 'targets/_shared/Palette.swift' && /UIColor\(\s*(red|white)\s*:/.test(text)) {
      offenders.push(`${rel}: UIColor component`);
    }
    if (rel.endsWith('.swift') && rel !== 'targets/_shared/Palette.swift') {
      if (/\.systemBlue\b|\.foregroundStyle\(\.orange\)|\.foregroundStyle\(\.secondary\)/.test(text)) {
        offenders.push(`${rel}: system color`);
      }
    }
    // CSS color calls in screens. pdf-lib's rgb() in src/lib is a drawing
    // command, not a UI color, so it is not a token violation.
    if (rel.endsWith('.tsx') && /rgba?\(/.test(text)) offenders.push(`${rel}: rgb()`);
    if (rel.endsWith('.ts') && /rgba\(/.test(text)) offenders.push(`${rel}: rgba()`);
  }
  assert.deepEqual(offenders, []);
});

test('document ink and the default QR colors match the token file', () => {
  assert.equal(INK_BLACK, documentInk.black);
  assert.equal(INK_BLUE, documentInk.blue);
  assert.equal(DEFAULT_QR_STYLE.foreground, documentInk.black);
  assert.equal(DEFAULT_QR_STYLE.background, light.onPrimary);
});
