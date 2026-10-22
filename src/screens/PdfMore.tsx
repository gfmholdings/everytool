import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, Field, GhostButton, PrimaryButton, Segmented } from '../components/ui';
import { useUndoHistory } from '../hooks/useUndoHistory';
import { formatBytes, shareFile } from '../lib/files';
import {
  applyPageLayout,
  compressPdfToSize,
  filesToPdf,
  loadSignFields,
  numberPdfPages,
  pdfPageSize,
  stampPdfWatermark,
  writeSignFill,
  type ConvertedFileNote,
  type PdfResult,
} from '../lib/pdf';
import {
  INK_BLACK,
  INK_BLUE,
  deleteMark,
  moveMark,
  placeMark,
  todayLabel,
  type FieldFill,
  type InkColor,
  type MarkKind,
  type PageMark,
  type SignField,
} from '../lib/pdfSign';
import { PDF_TARGET_CHIPS, parsePdfTarget, type NumberSpot, type WatermarkPlace } from '../lib/pdfTools';
import type { Palette } from '../theme';
import { useThemed } from '../useTheme';

type PdfFile = { uri: string; name: string; pages: number };

type SignDraft = {
  fills: Record<string, string>;
  marks: PageMark[];
  selected: string | null;
  ink: InkColor;
  signName: string;
};

const emptySign: SignDraft = {
  fills: {},
  marks: [],
  selected: null,
  ink: INK_BLACK,
  signName: '',
};

type OrderDraft = {
  order: number[];
  turns: Record<string, number>;
};

/**
 * Extra PDF tools under the merge / extract / compress flow.
 * Labels here stay clear of those three words so the existing taps
 * still land on the original controls.
 */
export function PdfMore({
  pdf,
  convertFiles,
  notify,
}: {
  pdf: PdfFile | null;
  convertFiles?: { uri: string; name: string }[];
  notify: (msg: string, action?: { label: string; onPress: () => void }) => void;
}) {
  const { type, styles } = useThemed(makeStyles);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PdfResult | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  const sign = useUndoHistory<SignDraft>(emptySign);
  const [fields, setFields] = useState<SignField[] | null>(null);
  const [page, setPage] = useState(0);

  const order = useUndoHistory<OrderDraft>({
    order: pdf ? Array.from({ length: pdf.pages }, (_, index) => index + 1) : [],
    turns: {},
  });
  const [spot, setSpot] = useState<NumberSpot>('bottom-center');
  const [ofTotal, setOfTotal] = useState(true);
  const [watermark, setWatermark] = useState('');
  const [place, setPlace] = useState<WatermarkPlace>('diagonal');
  const [targetId, setTargetId] = useState<string>(PDF_TARGET_CHIPS[2].id);
  const [customAmount, setCustomAmount] = useState('');
  const [customUnit, setCustomUnit] = useState<'KB' | 'MB'>('MB');
  const [notes, setNotes] = useState<ConvertedFileNote[]>([]);
  const convertStarted = useRef(false);

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work.');
    } finally {
      setBusy(false);
    }
  };

  const show = (next: PdfResult, message: string) => {
    setResult(next);
    setDetail(message);
    notify('PDF ready');
  };

  const readForm = () =>
    run(async () => {
      if (!pdf) throw new Error('Add a PDF above first.');
      setFields(await loadSignFields(pdf.uri));
    });

  const placeKind = (kind: MarkKind) =>
    run(async () => {
      if (!pdf) throw new Error('Add a PDF above first.');
      if (fields && fields.length > 0) throw new Error('This PDF has form fields. Fill those.');
      const box = await pdfPageSize(pdf.uri, page);
      const text =
        kind === 'date'
          ? todayLabel(new Date())
          : kind === 'check' || kind === 'cross'
            ? ''
            : sign.present.signName.trim();
      if ((kind === 'signature' || kind === 'name' || kind === 'initials' || kind === 'text') && !text) {
        throw new Error('Type a name first.');
      }
      const mark = placeMark({
        fields: [],
        page,
        pageWidth: box.width,
        pageHeight: box.height,
        x: box.width / 2,
        y: box.height / 2,
        kind,
        text,
        color: sign.present.ink,
        id: `mark-${Date.now().toString(36)}`,
      });
      if (!mark) throw new Error('This page can’t take that mark.');
      sign.commit((current) => ({
        ...current,
        marks: [...current.marks, mark],
        selected: mark.id,
      }));
    });

  const nudge = async (dx: number, dy: number) => {
    if (!pdf) return;
    const id = sign.present.selected;
    const mark = sign.present.marks.find((item) => item.id === id);
    if (!mark) return;
    const box = await pdfPageSize(pdf.uri, mark.page);
    sign.commit((current) => ({
      ...current,
      marks: current.marks.map((item) =>
        item.id === mark.id ? moveMark(item, dx, dy, box.width, box.height) : item,
      ),
    }));
  };

  const writeSigned = () =>
    run(async () => {
      if (!pdf) throw new Error('Add a PDF above first.');
      const fills: FieldFill[] = [];
      for (const field of fields ?? []) {
        if (!field.fillable) continue;
        const raw = (sign.present.fills[field.name] ?? '').trim();
        if (field.kind === 'checkbox') {
          if (raw === 'yes') fills.push({ name: field.name, checked: true });
          continue;
        }
        if (!raw) continue;
        if (field.kind === 'signature') {
          fills.push({
            name: field.name,
            signature: { mode: 'typed', text: raw, color: sign.present.ink, strokes: [] },
          });
        } else {
          fills.push({ name: field.name, text: raw });
        }
      }
      const next = await writeSignFill(pdf.uri, pdf.name, fills, sign.present.marks);
      const skipped = (fields ?? []).filter((field) => !field.fillable).length;
      show(next, skipped > 0 ? 'Filled fields were left as they were.' : 'Signature written on this phone.');
    });

  const movePage = (index: number, dir: -1 | 1) => {
    order.commit((current) => {
      const next = current.order.slice();
      const j = index + dir;
      if (j < 0 || j >= next.length) return current;
      const [item] = next.splice(index, 1);
      if (item == null) return current;
      next.splice(j, 0, item);
      return { ...current, order: next };
    });
  };

  const dropPage = (value: number) => {
    if (order.present.order.length < 2) return;
    order.commit((current) => ({
      ...current,
      order: current.order.filter((pageNo) => pageNo !== value),
    }));
    notify('Page removed', { label: 'Undo', onPress: () => order.undo() });
  };

  const turnPage = (value: number) => {
    order.commit((current) => ({
      ...current,
      turns: {
        ...current.turns,
        [String(value)]: ((current.turns[String(value)] ?? 0) + 1) % 4,
      },
    }));
  };

  const saveOrder = () =>
    run(async () => {
      if (!pdf) throw new Error('Add a PDF above first.');
      const turns = order.present.order.map((original, index) => ({
        page: index,
        quarterTurns: order.present.turns[String(original)] ?? 0,
      }));
      const next = await applyPageLayout(pdf.uri, order.present.order, turns);
      show(next, 'Page order saved. Text and fields stay.');
    });

  const numberPages = () =>
    run(async () => {
      if (!pdf) throw new Error('Add a PDF above first.');
      show(await numberPdfPages(pdf.uri, spot, ofTotal), 'Numbers added. The rest of the page stays.');
    });

  const stamp = () =>
    run(async () => {
      if (!pdf) throw new Error('Add a PDF above first.');
      if (!watermark.trim()) throw new Error('Type the watermark.');
      show(
        await stampPdfWatermark(pdf.uri, watermark.trim(), place),
        'Watermark stamped on every page.',
      );
    });

  const targetBytes = (): number | null => {
    if (targetId === 'custom') return parsePdfTarget(customAmount, customUnit);
    return PDF_TARGET_CHIPS.find((chip) => chip.id === targetId)?.bytes ?? null;
  };

  const fitSize = () =>
    run(async () => {
      if (!pdf) throw new Error('Add a PDF above first.');
      const maxBytes = targetBytes();
      if (maxBytes == null) throw new Error('Enter a target size.');
      const next = await compressPdfToSize(pdf.uri, maxBytes);
      show(next, next.message);
    });

  const runConvert = async (files: { uri: string; name: string }[]) => {
    const converted = await filesToPdf(files);
    setNotes(converted.notes);
    if (!converted.result) {
      setResult(null);
      setDetail(null);
      throw new Error('None of those files can become a PDF on this phone.');
    }
    const leftOut = converted.notes.filter((item) => !item.included);
    show(
      converted.result,
      leftOut.length > 0
        ? `${leftOut.length} file${leftOut.length === 1 ? '' : 's'} left out. See the notes.`
        : 'Every file is in the PDF.',
    );
  };

  useEffect(() => {
    if (convertStarted.current || !convertFiles?.length) return;
    convertStarted.current = true;
    void run(() => runConvert(convertFiles));
    // Opened files convert once. Later edits use the buttons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convertFiles]);

  const pickFiles = () =>
    run(async () => {
      const res = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (res.canceled || res.assets.length === 0) return;
      await runConvert(res.assets.map((asset) => ({ uri: asset.uri, name: asset.name })));
    });

  const fillable = (fields ?? []).filter((field) => field.fillable);
  const selected = sign.present.marks.find((mark) => mark.id === sign.present.selected) ?? null;

  return (
    <View style={styles.block}>
      <Text style={type.label}>Sign and fill</Text>
      <Text style={type.small}>
        Typed name, date, and checkmarks. A drawn pad is not on this phone. Radio buttons and
        choice lists stay as they are.
      </Text>
      <GhostButton label={busy ? 'Working…' : 'Read the form'} onPress={() => void readForm()} />
      {fields && fillable.length === 0 && (
        <>
          <Text style={type.small}>No empty form fields. Place a mark on the page.</Text>
          <Field
            value={sign.present.signName}
            onChange={(value) => sign.commit((current) => ({ ...current, signName: value }), true)}
            placeholder="Name to sign"
          />
          <View style={styles.row}>
            <Chip
              label="Black ink"
              active={sign.present.ink === INK_BLACK}
              onPress={() => sign.commit((current) => ({ ...current, ink: INK_BLACK }))}
            />
            <Chip
              label="Blue ink"
              active={sign.present.ink === INK_BLUE}
              onPress={() => sign.commit((current) => ({ ...current, ink: INK_BLUE }))}
            />
          </View>
          {pdf && pdf.pages > 1 && (
            <View style={styles.row}>
              <GhostButton label="Previous page" onPress={() => setPage((n) => Math.max(0, n - 1))} />
              <Text style={type.small}>
                Page {page + 1} / {pdf.pages}
              </Text>
              <GhostButton
                label="Next page"
                onPress={() => setPage((n) => Math.min(pdf.pages - 1, n + 1))}
              />
            </View>
          )}
          <View style={styles.row}>
            <GhostButton label="Place signature" onPress={() => void placeKind('signature')} />
            <GhostButton label="Place initials" onPress={() => void placeKind('initials')} />
          </View>
          <View style={styles.row}>
            <GhostButton label="Place date" onPress={() => void placeKind('date')} />
            <GhostButton label="Place check" onPress={() => void placeKind('check')} />
          </View>
          {sign.present.marks.map((mark) => (
            <Pressable key={mark.id} onPress={() => sign.commit((current) => ({ ...current, selected: mark.id }))}>
              <Text style={[type.small, selected?.id === mark.id && styles.strong]}>
                {mark.kind} on page {mark.page + 1}
              </Text>
            </Pressable>
          ))}
          {selected && (
            <View style={styles.row}>
              <GhostButton label="Nudge left" onPress={() => void nudge(-12, 0)} />
              <GhostButton label="Nudge right" onPress={() => void nudge(12, 0)} />
              <GhostButton label="Nudge up" onPress={() => void nudge(0, 12)} />
              <GhostButton label="Nudge down" onPress={() => void nudge(0, -12)} />
              <GhostButton
                label="Remove mark"
                onPress={() => {
                  sign.commit((current) => ({
                    ...current,
                    marks: deleteMark(current.marks, selected.id),
                    selected: null,
                  }));
                  notify('Removed', { label: 'Undo', onPress: () => sign.undo() });
                }}
              />
            </View>
          )}
        </>
      )}
      {fillable.map((field) => (
        <View key={field.name} style={styles.fieldBlock}>
          <Text style={type.small}>
            {field.name} · {field.kind}
          </Text>
          {field.kind === 'checkbox' ? (
            <Chip
              label={sign.present.fills[field.name] === 'yes' ? 'Checked' : 'Not checked'}
              active={sign.present.fills[field.name] === 'yes'}
              onPress={() =>
                sign.commit((current) => ({
                  ...current,
                  fills: {
                    ...current.fills,
                    [field.name]: current.fills[field.name] === 'yes' ? '' : 'yes',
                  },
                }))
              }
            />
          ) : (
            <Field
              value={sign.present.fills[field.name] ?? ''}
              onChange={(value) =>
                sign.commit(
                  (current) => ({ ...current, fills: { ...current.fills, [field.name]: value } }),
                  true,
                )
              }
              placeholder={field.kind === 'signature' ? 'Typed signature' : field.kind === 'date' ? 'Date' : 'Text'}
            />
          )}
          {field.kind === 'date' && (
            <GhostButton
              label="Use today"
              onPress={() =>
                sign.commit((current) => ({
                  ...current,
                  fills: { ...current.fills, [field.name]: todayLabel(new Date()) },
                }))
              }
            />
          )}
        </View>
      ))}
      <PrimaryButton label={busy ? 'Working…' : 'Write onto the PDF'} onPress={() => void writeSigned()} disabled={!pdf || busy} />

      <Text style={type.label}>Page order</Text>
      <Text style={type.small}>Move, turn, or drop a page. The words on the page stay.</Text>
      {order.present.order.map((pageNo, index) => {
        const quarter = order.present.turns[String(pageNo)] ?? 0;
        return (
          <Card key={`${pageNo}-${index}`} style={styles.rowCard}>
            <Text style={[type.body, styles.flex]}>
              Page {pageNo}
              {quarter ? ` · ${quarter * 90}°` : ''}
            </Text>
            <GhostButton label="Up" onPress={() => movePage(index, -1)} />
            <GhostButton label="Down" onPress={() => movePage(index, 1)} />
            <GhostButton label="Turn" onPress={() => turnPage(pageNo)} />
            <GhostButton label="Drop" onPress={() => dropPage(pageNo)} />
          </Card>
        );
      })}
      <PrimaryButton label={busy ? 'Working…' : 'Save this order'} onPress={() => void saveOrder()} disabled={!pdf || busy} />

      <Text style={type.label}>Page numbers</Text>
      <Segmented
        options={[
          { id: 'bottom-center' as NumberSpot, label: 'Bottom' },
          { id: 'bottom-left' as NumberSpot, label: 'Left' },
          { id: 'bottom-right' as NumberSpot, label: 'Right' },
          { id: 'top-center' as NumberSpot, label: 'Top' },
        ]}
        value={spot}
        onChange={setSpot}
      />
      <Chip label={ofTotal ? 'Show total' : 'Number only'} active={ofTotal} onPress={() => setOfTotal((v) => !v)} />
      <PrimaryButton label={busy ? 'Working…' : 'Number the pages'} onPress={() => void numberPages()} disabled={!pdf || busy} />

      <Text style={type.label}>Watermark</Text>
      <Field value={watermark} onChange={setWatermark} placeholder="Watermark text" />
      <Segmented
        options={[
          { id: 'diagonal' as WatermarkPlace, label: 'Diagonal' },
          { id: 'center' as WatermarkPlace, label: 'Level' },
        ]}
        value={place}
        onChange={setPlace}
      />
      <PrimaryButton label={busy ? 'Working…' : 'Stamp this text'} onPress={() => void stamp()} disabled={!pdf || busy} />

      <Text style={type.label}>Files to PDF</Text>
      <Text style={type.small}>
        Text, Markdown, CSV, RTF, JPEG, PNG, and PDF. Word, Excel, PowerPoint, Pages, Numbers,
        Keynote, web pages, and photos that need a phone decoder are listed and left out.
      </Text>
      <PrimaryButton label={busy ? 'Working…' : 'Choose files'} onPress={() => void pickFiles()} disabled={busy} />
      {notes.map((item) => (
        <Text key={item.name} style={type.small}>
          {item.included ? 'In the PDF' : 'Left out'} · {item.name}. {item.note}
        </Text>
      ))}

      <Text style={type.label}>Target size</Text>
      <Text style={type.small}>
        Photos inside the PDF are recompressed. Text, fonts, and form fields stay. Pages are not redrawn.
      </Text>
      <View style={styles.wrap}>
        {PDF_TARGET_CHIPS.map((chip) => (
          <Chip key={chip.id} label={chip.label} active={targetId === chip.id} onPress={() => setTargetId(chip.id)} />
        ))}
        <Chip label="Custom size" active={targetId === 'custom'} onPress={() => setTargetId('custom')} />
      </View>
      {targetId === 'custom' && (
        <View style={styles.row}>
          <View style={styles.flex}>
            <Field value={customAmount} onChange={setCustomAmount} placeholder="Size" keyboard="decimal-pad" />
          </View>
          <Segmented
            options={[
              { id: 'KB' as const, label: 'KB' },
              { id: 'MB' as const, label: 'MB' },
            ]}
            value={customUnit}
            onChange={setCustomUnit}
          />
        </View>
      )}
      <PrimaryButton label={busy ? 'Working…' : 'Fit to this size'} onPress={() => void fitSize()} disabled={!pdf || busy} />

      {!!error && <Text style={styles.error}>{error}</Text>}
      {result && (
        <Card style={styles.result}>
          <Text style={type.label}>Ready</Text>
          <Text style={type.numSmall}>
            Page count {result.pages} · {formatBytes(result.bytes)}
          </Text>
          {!!detail && <Text style={type.small}>{detail}</Text>}
          <PrimaryButton label="Share this file" onPress={() => void shareFile(result.uri, 'application/pdf')} />
        </Card>
      )}
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { styles } = useThemed(makeStyles);
  return (
    <Text onPress={onPress} style={[styles.chip, active && styles.chipOn]}>
      {label}
    </Text>
  );
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    block: { gap: 10, marginTop: 8 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    rowCard: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
    fieldBlock: { gap: 6 },
    flex: { flex: 1 },
    strong: { color: p.primary, fontWeight: '700' },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 16,
      backgroundColor: p.secondary,
      color: p.onSecondary,
      overflow: 'hidden',
      fontWeight: '600',
    },
    chipOn: { backgroundColor: p.primary, color: p.onPrimary },
    result: { gap: 8 },
    error: { color: p.destructive, fontSize: 15 },
  });
}
