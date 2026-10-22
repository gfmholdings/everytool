import assert from 'node:assert/strict';
import test from 'node:test';

import { contactPayload, wifiPayload } from '../src/lib/qrpayload.ts';
import { DEFAULT_QR_STYLE, saveQrHistory } from '../src/lib/qrHistory.ts';
import {
  QR_AUTOSAVE_MS,
  autosaveDecision,
  displayedQr,
  emptyMaker,
  payloadFor,
  switchMakerKind,
  type MakerFields,
} from '../src/lib/qrMaker.ts';

const LINK = 'https://example.com/everytool';

function textFields(text: string): MakerFields {
  return { ...emptyMaker(), text };
}

test('qr maker: keystrokes wait, and only the settled code is saved', () => {
  let lastSaved: string | null = null;
  const saved: string[] = [];
  for (const text of ['h', 'ht', 'htt', LINK]) {
    const decision = autosaveDecision({
      payload: payloadFor(textFields(text)),
      lastSaved,
      quietMs: 40,
      leaving: false,
    });
    if (decision.save) saved.push(decision.save);
    lastSaved = decision.lastSaved;
  }
  assert.deepEqual(saved, []);
  assert.equal(lastSaved, null);

  const settled = autosaveDecision({
    payload: payloadFor(textFields(LINK)),
    lastSaved,
    quietMs: QR_AUTOSAVE_MS,
    leaving: false,
  });
  assert.equal(settled.save, LINK);
  assert.equal(settled.lastSaved, LINK);

  const again = autosaveDecision({
    payload: payloadFor(textFields(LINK)),
    lastSaved: settled.lastSaved,
    quietMs: QR_AUTOSAVE_MS,
    leaving: false,
  });
  assert.equal(again.save, null);
  assert.deepEqual(saved.concat(settled.save ?? []), [LINK]);
});

test('qr maker: leaving before the debounce commits the latest code once', () => {
  let lastSaved: string | null = null;
  const partial = autosaveDecision({
    payload: payloadFor(textFields('https://ex')),
    lastSaved,
    quietMs: 50,
    leaving: false,
  });
  assert.equal(partial.save, null);
  lastSaved = partial.lastSaved;

  const left = autosaveDecision({
    payload: payloadFor(textFields(LINK)),
    lastSaved,
    quietMs: 50,
    leaving: true,
  });
  assert.equal(left.save, LINK);

  const leftAgain = autosaveDecision({
    payload: payloadFor(textFields(LINK)),
    lastSaved: left.lastSaved,
    quietMs: 0,
    leaving: true,
  });
  assert.equal(leftAgain.save, null);
});

test('qr maker: switching type saves the previous code and shows an empty type', () => {
  const typed = textFields(LINK);
  assert.equal(displayedQr(typed), LINK);

  const commit = autosaveDecision({
    payload: payloadFor(typed),
    lastSaved: null,
    quietMs: 20,
    leaving: true,
  });
  assert.equal(commit.save, LINK);

  const wifi = switchMakerKind(typed, 'wifi');
  assert.equal(wifi.kind, 'wifi');
  assert.equal(wifi.text, '');
  assert.equal(wifi.ssid, '');
  assert.equal(wifi.password, '');
  assert.equal(wifi.name, '');
  assert.equal(displayedQr(wifi), null);

  const withNetwork: MakerFields = {
    ...wifi,
    ssid: 'Cafe',
    password: "p'word",
    security: 'WPA',
  };
  assert.equal(displayedQr(withNetwork), wifiPayload('Cafe', "p'word", 'WPA'));

  const contact = switchMakerKind(withNetwork, 'contact');
  assert.equal(displayedQr(contact), null);
  assert.equal(contact.ssid, '');
  assert.equal(contact.name, '');

  const filled: MakerFields = { ...contact, name: 'Ada, Lovelace', phone: '555', email: 'ada@example.com' };
  assert.equal(
    payloadFor(filled),
    contactPayload({ name: 'Ada, Lovelace', phone: '555', email: 'ada@example.com' }),
  );

  const backToText = switchMakerKind(filled, 'text');
  assert.deepEqual(backToText, emptyMaker('text'));
  assert.equal(displayedQr(backToText), null);
  assert.equal(switchMakerKind(backToText, 'text'), backToText);
});

test('qr maker: opening the tool starts empty, with no carried QR', () => {
  const entered = emptyMaker();
  assert.equal(entered.kind, 'text');
  assert.equal(entered.text, '');
  assert.equal(displayedQr(entered), null);
  assert.equal(
    autosaveDecision({ payload: displayedQr(entered), lastSaved: null, quietMs: 0, leaving: true }).save,
    null,
  );
});

test('qr maker: a new session of the same code still dedupes to one history row', () => {
  const first = saveQrHistory(
    [],
    { direction: 'made', payload: LINK, style: DEFAULT_QR_STYLE },
    1_000,
    'a',
  );
  const session = autosaveDecision({
    payload: LINK,
    lastSaved: null,
    quietMs: QR_AUTOSAVE_MS,
    leaving: false,
  });
  assert.equal(session.save, LINK);
  const second = saveQrHistory(
    first.items,
    { direction: 'made', payload: session.save ?? '', style: DEFAULT_QR_STYLE },
    2_000,
    'b',
  );
  assert.equal(second.items.length, 1);
  assert.equal(second.items[0]!.id, 'a');
  assert.equal(second.items[0]!.payload, LINK);
  assert.equal(second.items[0]!.createdAt, 2_000);

  let lastSaved: string | null = null;
  let items = second.items;
  for (const text of ['h', 'ht', LINK]) {
    const decision = autosaveDecision({
      payload: payloadFor(textFields(text)),
      lastSaved,
      quietMs: 10,
      leaving: false,
    });
    if (decision.save) {
      items = saveQrHistory(
        items,
        { direction: 'made', payload: decision.save, style: DEFAULT_QR_STYLE },
        3_000,
        'c',
      ).items;
    }
    lastSaved = decision.lastSaved;
  }
  assert.equal(items.length, 1);
  assert.equal(items[0]!.id, 'a');
});
