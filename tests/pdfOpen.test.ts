import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  CONVERT_OPEN_UTIS,
  PDF_HANDLER_RANK,
  PDF_OPEN_SCREEN,
  PDF_UTI,
  convertDisplayName,
  isConvertOpenFileUrl,
  isPdfFileUrl,
  pdfDisplayName,
  pdfTargetFromShare,
  routeIncomingUrl,
  sandboxConvertFileName,
  sandboxPdfFileName,
  shareActionFor,
  toolRefFromUrl,
} from '../src/lib/pdfOpen.ts';

const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')) as {
  expo: { ios: { infoPlist: Record<string, unknown> } };
};

test('document handler: com.adobe.pdf at Alternate, in place, no default claim', () => {
  const plist = app.expo.ios.infoPlist;
  // iOS has no user-selectable default PDF app. Alternate is the Open In
  // and share-sheet rank, so Everytool appears there and does not take over.
  assert.equal(plist.LSSupportsOpeningDocumentsInPlace, true);
  assert.equal(plist.UISupportsDocumentBrowser, true);
  const types = plist.CFBundleDocumentTypes as {
    CFBundleTypeName: string;
    CFBundleTypeRole: string;
    LSHandlerRank: string;
    LSItemContentTypes: string[];
  }[];
  assert.equal(types.length, 2);
  assert.equal(types[0]!.LSHandlerRank, PDF_HANDLER_RANK);
  assert.equal(types[0]!.LSHandlerRank, 'Alternate');
  assert.deepEqual(types[0]!.LSItemContentTypes, [PDF_UTI]);
  assert.equal(types[0]!.CFBundleTypeRole, 'Viewer');
  assert.equal(PDF_UTI, 'com.adobe.pdf');
  assert.equal(types[1]!.CFBundleTypeName, 'Document');
  assert.equal(types[1]!.LSHandlerRank, 'Alternate');
  assert.equal(types[1]!.CFBundleTypeRole, 'Viewer');
  assert.deepEqual(types[1]!.LSItemContentTypes, [...CONVERT_OPEN_UTIS]);
});

test('incoming URL: a PDF file opens the existing PDF tool, not Sign & Fill', () => {
  const route = routeIncomingUrl(
    'file:///private/var/mobile/Containers/Data/Application/ABC/Documents/Inbox/lease.pdf',
  );
  assert.deepEqual(route, {
    kind: 'pdf',
    tool: 'pdf',
    screen: PDF_OPEN_SCREEN,
    name: 'lease.pdf',
  });
  assert.equal(PDF_OPEN_SCREEN, 'viewer');
  assert.equal(isPdfFileUrl('file:///tmp/Scan.PDF'), true);
  assert.equal(pdfDisplayName('file:///tmp/My%20Lease.PDF'), 'My Lease.PDF');
  assert.equal(routeIncomingUrl('file:///tmp/My%20Lease.PDF').kind, 'pdf');
});

test('incoming URL: text and HTML from Files open convert; photos and Office do not', () => {
  assert.deepEqual(routeIncomingUrl('file:///tmp/notes.txt'), {
    kind: 'convert',
    tool: 'pdf',
    screen: 'convert',
    name: 'notes.txt',
  });
  assert.equal(routeIncomingUrl('file:///tmp/budget.csv').kind, 'convert');
  assert.equal(routeIncomingUrl('file:///tmp/page.html').kind, 'convert');
  assert.equal(isConvertOpenFileUrl('file:///tmp/saved.webarchive'), true);
  assert.equal(convertDisplayName('file:///tmp/My%20Notes.md'), 'My Notes.md');
  assert.equal(sandboxConvertFileName('My Notes.md', '171'), '171-My Notes.md');
  // Photos stay on the share sheet. Office is not an Open In type.
  assert.equal(routeIncomingUrl('file:///tmp/photo.png').kind, 'ignore');
  assert.equal(routeIncomingUrl('file:///tmp/Report.docx').kind, 'ignore');
  assert.equal(routeIncomingUrl('file:///tmp/Deck.key').kind, 'ignore');
  assert.equal(routeIncomingUrl('https://example.com/lease.pdf').kind, 'ignore');
  assert.equal(isPdfFileUrl('everytool://tool/pdf'), false);
});

test('incoming URL: everytool links stay tool links, including the share extension open', () => {
  assert.deepEqual(routeIncomingUrl('everytool://tool/pdf'), { kind: 'tool', ref: 'pdf' });
  assert.equal(toolRefFromUrl('everytool://tool/stitch'), 'stitch');
  assert.equal(toolRefFromUrl('everytool://tool/stitch/record'), 'stitch/record');
  assert.equal(toolRefFromUrl('everytool://stitch'), 'stitch');
  assert.equal(toolRefFromUrl('everytool://record'), 'record');
  assert.equal(toolRefFromUrl('everytool://session'), 'session');
  assert.equal(toolRefFromUrl('file:///tmp/lease.pdf'), null);
});

test('sandbox copy name keeps the title and does not collide', () => {
  assert.equal(sandboxPdfFileName('lease.pdf', '1710000000'), '1710000000-lease.pdf');
  assert.equal(sandboxPdfFileName('a/b?.pdf', 'id'), 'id-ab.pdf');
  assert.equal(sandboxPdfFileName('', ''), 'open-document.pdf');
  assert.equal(pdfDisplayName('file:///'), 'document.pdf');
});

test('share action: a PDF opens the PDF tool; the inbox file is what loads', () => {
  assert.equal(shareActionFor(['pdf']), 'pdf');
  assert.equal(shareActionFor(['pdf', 'pdf']), 'pdf');
  assert.equal(shareActionFor(['image']), null);
  assert.equal(shareActionFor(['text']), null);
  assert.equal(shareActionFor([]), null);

  assert.deepEqual(
    pdfTargetFromShare([
      { kind: 'pdf', tool: 'convert', file: 'share-1.pdf', name: 'lease.pdf' },
    ]),
    { tool: 'pdf', screen: 'viewer', file: 'share-1.pdf', name: 'lease.pdf' },
  );
  assert.equal(
    pdfTargetFromShare([{ kind: 'pdf', tool: 'pdf', file: 'share-2.pdf' }])?.tool,
    'pdf',
  );
  assert.equal(
    pdfTargetFromShare([
      { kind: 'text', tool: 'clipboard', file: 'share-3.txt' },
      { kind: 'pdf', tool: 'pdf', file: 'share-4.pdf', name: 'lease.pdf' },
    ]),
    null,
  );
  assert.equal(pdfTargetFromShare([{ kind: 'image', tool: 'resize', file: 'share-5.png' }]), null);
});

test('native open handler copies a security-scoped PDF before JS reads it', () => {
  const swift = readFileSync(
    new URL('../modules/shared-vault/ios/PdfDocumentHandler.swift', import.meta.url),
    'utf8',
  );
  assert.match(swift, /ExpoAppDelegateSubscriber/);
  assert.match(swift, /startAccessingSecurityScopedResource/);
  assert.match(swift, /stopAccessingSecurityScopedResource/);
  assert.match(swift, /copyItem/);
  assert.match(swift, /func application\(\s*_ app: UIApplication,\s*open url: URL/);
  const config = readFileSync(
    new URL('../modules/shared-vault/expo-module.config.json', import.meta.url),
    'utf8',
  );
  assert.match(config, /PdfDocumentHandler/);
  const share = readFileSync(
    new URL('../targets/share/ShareViewController.swift', import.meta.url),
    'utf8',
  );
  assert.match(share, /route\("pdf"\)/);
  assert.match(share, /onRouted\("pdf"\)/);
  assert.match(share, /kind == "pdf"/);
  assert.match(swift, /convertExtensions/);
  assert.match(swift, /"csv"/);
  assert.match(swift, /sandboxConvertFileName/);
});
