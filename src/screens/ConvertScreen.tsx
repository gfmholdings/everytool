import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text } from 'react-native';

import { Card, GhostButton, PrimaryButton, Segmented, ToolShell } from '../components/ui';
import { formatBytes, measureImage, saveToPhotos, shareFile, tempFileUri } from '../lib/files';
import { mergePdfSources, pdfSourceFromUri, type PdfSource } from '../lib/pdf';
import { colors, type } from '../theme';

type Format = 'jpg' | 'png' | 'pdf';

interface Source {
  uri: string;
  name?: string;
  width: number;
  height: number;
}

interface Result {
  uri: string;
  filename: string;
  bytes: number;
  width: number;
  height: number;
}

/**
 * Convert: one photo → JPG / PNG / PDF, or several photos → one PDF.
 * JPG/PNG go through the platform encoder; PDFs are built by pdf-lib from
 * the JPEG encode, page sized to the photo. All on-device.
 */
export function ConvertScreen({
  onBack,
  initialSource,
  notify,
}: {
  onBack: () => void;
  initialSource?: Source;
  notify: (msg: string) => void;
}) {
  const [sources, setSources] = useState<Source[]>(
    initialSource ? [initialSource] : [],
  );
  const [format, setFormat] = useState<Format>('jpg');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Files from the share sheet arrive without a size; measure them.
  useEffect(() => {
    const unknown = sources.filter((x) => x.width <= 0 || x.height <= 0);
    if (unknown.length === 0) return;
    let live = true;
    void Promise.all(
      sources.map(async (x) =>
        x.width > 0 && x.height > 0 ? x : { ...x, ...(await measureImage(x.uri)) },
      ),
    ).then((measured) => {
      if (live) setSources(measured);
    });
    return () => {
      live = false;
    };
  }, [sources]);

  const multi = sources.length > 1;
  const effectiveFormat: Format = multi ? 'pdf' : format;

  const pick = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('Photo access is off. Turn it on in Settings to pick photos.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 12,
      quality: 1,
    });
    if (res.canceled) return;
    setSources(
      res.assets.map((a, i) => ({
        uri: a.uri,
        name: a.fileName ?? `photo-${i + 1}`,
        width: a.width,
        height: a.height,
      })),
    );
    setResult(null);
    setError(null);
  };

  const convert = async () => {
    const first = sources[0];
    if (!first) return;
    setBusy(true);
    setError(null);
    try {
      if (effectiveFormat === 'pdf') {
        const pdfSources: PdfSource[] = [];
        for (const s of sources) {
          // pdf-lib embeds JPEG; normalize each photo to a JPEG file.
          const jpg = await manipulateAsync(s.uri, [], {
            format: SaveFormat.JPEG,
            compress: 0.92,
          });
          pdfSources.push(
            await pdfSourceFromUri(jpg.uri, s.name ?? 'photo', 'image'),
          );
        }
        const out = await mergePdfSources(pdfSources);
        setResult({
          uri: out.uri,
          filename: 'photos.pdf',
          bytes: out.bytes,
          width: first.width,
          height: first.height,
        });
      } else {
        const out = await manipulateAsync(
          first.uri,
          [],
          {
            format: effectiveFormat === 'jpg' ? SaveFormat.JPEG : SaveFormat.PNG,
            compress: effectiveFormat === 'jpg' ? 0.92 : 1,
          },
        );
        const target = tempFileUri(effectiveFormat, 'convert');
        await new File(out.uri).copy(new File(target));
        const info = new File(target);
        setResult({
          uri: target,
          filename: `converted.${effectiveFormat}`,
          bytes: info.size ?? 0,
          width: out.width,
          height: out.height,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Conversion failed.');
    } finally {
      setBusy(false);
    }
  };

  const saveImage = async () => {
    if (!result || effectiveFormat === 'pdf') return;
    const problem = await saveToPhotos(result.uri);
    if (problem) setError(problem);
    else notify('Saved to Photos');
  };

  const first = sources[0];

  return (
    <ToolShell title="Convert" onBack={onBack}>
      {first ? (
        <Card style={styles.previewCard}>
          <Image source={{ uri: first.uri }} style={styles.preview} />
          <Text style={type.small}>
            {sources.length === 1
              ? `${first.width} × ${first.height}`
              : `${sources.length} photos → one PDF`}
          </Text>
        </Card>
      ) : null}
      <PrimaryButton
        label={first ? 'Pick different photos' : 'Pick photos'}
        onPress={pick}
      />
      {first && !multi && (
        <Segmented
          options={[
            { id: 'jpg', label: 'JPG' },
            { id: 'png', label: 'PNG' },
            { id: 'pdf', label: 'PDF' },
          ]}
          value={format}
          onChange={(f) => {
            setFormat(f);
            setResult(null);
          }}
        />
      )}
      {first && (
        <PrimaryButton
          label={busy ? 'Converting…' : `Convert to ${effectiveFormat.toUpperCase()}`}
          onPress={convert}
          disabled={busy}
          orange
        />
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
      {result && (
        <Card style={styles.resultCard}>
          <Text style={type.label}>Done</Text>
          <Text style={type.numSmall}>
            {result.filename} · {formatBytes(result.bytes)}
          </Text>
          <PrimaryButton
            label="Share file"
            onPress={() =>
              void shareFile(
                result.uri,
                effectiveFormat === 'pdf'
                  ? 'application/pdf'
                  : `image/${effectiveFormat}`,
              )
            }
          />
          {effectiveFormat !== 'pdf' && (
            <GhostButton label="Save to Photos" onPress={() => void saveImage()} />
          )}
        </Card>
      )}
    </ToolShell>
  );
}

const styles = StyleSheet.create({
  previewCard: { alignItems: 'center', gap: 8 },
  preview: { width: '100%', height: 220, borderRadius: 10, backgroundColor: colors.border },
  resultCard: { gap: 10 },
  error: { color: colors.danger, fontSize: 15 },
});
