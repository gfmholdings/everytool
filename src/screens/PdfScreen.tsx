import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, Field, GhostButton, PrimaryButton, Segmented, ToolShell } from '../components/ui';
import { formatBytes, shareFile } from '../lib/files';
import {
  compressPdf,
  extractPdfPages,
  mergePdfSources,
  pdfSourceFromUri,
  type PdfResult,
  type PdfSource,
} from '../lib/pdf';
import { specToIndices } from '../lib/pages';
import { colors, type } from '../theme';

type Mode = 'merge' | 'split' | 'compress';

/**
 * PDF tools (pdf-lib): merge PDFs and photos in a reorderable list,
 * extract a page range, compress by re-saving with object streams.
 */
export function PdfScreen({
  onBack,
  initialPdf,
  notify,
}: {
  onBack: () => void;
  initialPdf?: { uri: string; name: string };
  notify: (msg: string) => void;
}) {
  const [mode, setMode] = useState<Mode>('merge');
  const [sources, setSources] = useState<PdfSource[]>([]);
  const [spec, setSpec] = useState('');
  const [result, setResult] = useState<PdfResult | null>(null);
  const [beforeBytes, setBeforeBytes] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);

  if (initialPdf && !seeded) {
    setSeeded(true);
    void pdfSourceFromUri(initialPdf.uri, initialPdf.name, 'pdf').then((s) =>
      setSources([s]),
    );
  }

  const addPdfs = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (res.canceled) return;
    const added: PdfSource[] = [];
    for (const asset of res.assets) {
      added.push(await pdfSourceFromUri(asset.uri, asset.name, 'pdf'));
    }
    setSources((s) => [...s, ...added]);
    setResult(null);
  };

  const addPhotos = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 12,
      quality: 1,
    });
    if (res.canceled) return;
    const added: PdfSource[] = [];
    for (const [i, a] of res.assets.entries()) {
      const jpg = await manipulateAsync(a.uri, [], {
        format: SaveFormat.JPEG,
        compress: 0.9,
      });
      added.push(
        await pdfSourceFromUri(jpg.uri, a.fileName ?? `photo-${i + 1}`, 'image'),
      );
    }
    setSources((s) => [...s, ...added]);
    setResult(null);
  };

  const move = (index: number, dir: -1 | 1) => {
    setSources((s) => {
      const next = [...s];
      const j = index + dir;
      if (j < 0 || j >= next.length) return s;
      const [item] = next.splice(index, 1);
      if (item) next.splice(j, 0, item);
      return next;
    });
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'merge') {
        if (sources.length < 2) throw new Error('Add at least two files.');
        setResult(await mergePdfSources(sources));
      } else if (mode === 'split') {
        const first = sources[0];
        if (!first || first.kind !== 'pdf')
          throw new Error('Add a PDF first.');
        const indices = specToIndices(spec, first.pages);
        if (indices.length === 0)
          throw new Error('Write pages like 1, 3, 5-7.');
        setResult(await extractPdfPages(first.uri, indices));
      } else {
        const first = sources[0];
        if (!first || first.kind !== 'pdf')
          throw new Error('Add a PDF first.');
        setBeforeBytes(new File(first.uri).size ?? 0);
        setResult(await compressPdf(first.uri));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work.');
    } finally {
      setBusy(false);
    }
  };

  const totalPages = sources.reduce((n, s) => n + s.pages, 0);

  return (
    <ToolShell title="PDF tools" onBack={onBack}>
      <Segmented
        options={[
          { id: 'merge', label: 'Merge' },
          { id: 'split', label: 'Split' },
          { id: 'compress', label: 'Compress' },
        ]}
        value={mode}
        onChange={(m) => {
          setMode(m);
          setResult(null);
        }}
      />

      {sources.map((s, i) => (
        <Card key={s.id} style={styles.row}>
          <View style={styles.rowMain}>
            <Text style={type.body} numberOfLines={1}>
              {s.name}
            </Text>
            <Text style={type.small}>
              {s.kind === 'pdf' ? `${s.pages} page${s.pages === 1 ? '' : 's'}` : 'photo'}
            </Text>
          </View>
          {mode === 'merge' && (
            <View style={styles.rowActions}>
              <Pressable onPress={() => move(i, -1)} style={styles.arrowBtn}>
                <Text style={styles.arrow}>↑</Text>
              </Pressable>
              <Pressable onPress={() => move(i, 1)} style={styles.arrowBtn}>
                <Text style={styles.arrow}>↓</Text>
              </Pressable>
            </View>
          )}
          <Pressable
            onPress={() => setSources((all) => all.filter((x) => x.id !== s.id))}
            style={styles.arrowBtn}
          >
            <Text style={styles.remove}>✕</Text>
          </Pressable>
        </Card>
      ))}

      <View style={styles.addRow}>
        <View style={styles.addHalf}>
          <PrimaryButton label="Add PDFs" onPress={addPdfs} />
        </View>
        <View style={styles.addHalf}>
          <PrimaryButton label="Add photos" onPress={addPhotos} />
        </View>
      </View>

      {mode === 'split' && sources[0] && (
        <>
          <Field
            value={spec}
            onChange={setSpec}
            placeholder={`Pages to keep — e.g. 1, 3, 5-7 (of ${sources[0].pages})`}
          />
        </>
      )}

      {sources.length > 0 && mode === 'merge' && (
        <Text style={type.small}>{totalPages} pages in order</Text>
      )}

      <PrimaryButton
        label={
          busy
            ? 'Working…'
            : mode === 'merge'
              ? 'Merge into one PDF'
              : mode === 'split'
                ? 'Make the split PDF'
                : 'Compress'
        }
        onPress={run}
        disabled={busy || sources.length === 0}
        orange
      />
      {!!error && <Text style={styles.error}>{error}</Text>}

      {result && (
        <Card style={styles.resultCard}>
          <Text style={type.label}>Done</Text>
          <Text style={type.numSmall}>
            {result.pages} page{result.pages === 1 ? '' : 's'} ·{' '}
            {formatBytes(result.bytes)}
          </Text>
          {mode === 'compress' && beforeBytes > 0 && (
            <Text style={type.small}>
              Was {formatBytes(beforeBytes)} — saved{' '}
              {formatBytes(Math.max(0, beforeBytes - result.bytes))}
            </Text>
          )}
          <PrimaryButton
            label="Share PDF"
            onPress={() => void shareFile(result.uri, 'application/pdf')}
          />
          <GhostButton
            label="Use as new source"
            onPress={() =>
              void pdfSourceFromUri(result.uri, 'result.pdf', 'pdf').then(
                (s) => {
                  setSources([s]);
                  setResult(null);
                  notify('Result loaded');
                },
              )
            }
          />
        </Card>
      )}
    </ToolShell>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowMain: { flex: 1, gap: 2 },
  rowActions: { flexDirection: 'row' },
  arrowBtn: { padding: 8 },
  arrow: { fontSize: 18, color: colors.accent, fontWeight: '700' },
  remove: { fontSize: 15, color: colors.faint },
  addRow: { flexDirection: 'row', gap: 10 },
  addHalf: { flex: 1 },
  resultCard: { gap: 10 },
  error: { color: colors.danger, fontSize: 15 },
});
