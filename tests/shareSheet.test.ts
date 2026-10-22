import assert from 'node:assert/strict';
import test from 'node:test';

import { evenBillShareText, itemBillShareText } from '../src/lib/money.ts';
import { fileShareUrl, pngFileBase64, shareItem } from '../src/lib/shareSheet.ts';

test('share sheet: an image is a file URL and never a text item', () => {
  const item = shareItem({
    uri: '/var/mobile/Containers/Data/qr.png',
    mimeType: 'image/png',
    text: 'https://example.com/everytool',
    subject: 'https://example.com/everytool',
  });
  assert.deepEqual(item, {
    url: 'file:///var/mobile/Containers/Data/qr.png',
    subject: 'https://example.com/everytool',
  });
  assert.equal('message' in item, false);
  assert.equal(
    fileShareUrl('file:///tmp/shot.png'),
    'file:///tmp/shot.png',
  );
});

test('share sheet: jpeg, heic, gif, and pdf stay files; a web link is not a file', () => {
  assert.equal(shareItem({ uri: 'file:///tmp/a.jpg', mimeType: 'image/jpeg' }).url, 'file:///tmp/a.jpg');
  assert.equal(shareItem({ uri: 'file:///tmp/a.heic', mimeType: 'image/heic' }).url, 'file:///tmp/a.heic');
  assert.equal(shareItem({ uri: 'file:///tmp/a.gif', mimeType: 'image/gif' }).url, 'file:///tmp/a.gif');
  assert.equal(shareItem({ uri: 'file:///tmp/a.pdf', mimeType: 'application/pdf' }).url, 'file:///tmp/a.pdf');
  assert.deepEqual(shareItem({ uri: 'https://example.com/code.png', mimeType: 'image/png' }), {});
});

test('share sheet: plain text has no file URL', () => {
  assert.deepEqual(shareItem({ text: '  Cafe password  ' }), { message: 'Cafe password' });
  assert.deepEqual(shareItem({ text: '   ' }), {});
});

test('share sheet: a data-URL prefix is removed before the PNG is written', () => {
  assert.equal(pngFileBase64('data:image/png;base64,AAAA'), 'AAAA');
  assert.equal(pngFileBase64('  AAAA  '), 'AAAA');
});

test('share sheet: a bill split is text, one line per person', () => {
  assert.equal(
    evenBillShareText({ people: 2, tipCents: 200, grandCents: 1200, sharesCents: [600, 600] }),
    ['Split bill', 'Total with tax and tip: $12.00', 'Tip: $2.00', 'Each of 2: $6.00'].join('\n'),
  );
  assert.equal(
    itemBillShareText([400, 800]),
    ['Split bill', 'Person A pays $4.00', 'Person B pays $8.00', 'Total: $12.00'].join('\n'),
  );
});
