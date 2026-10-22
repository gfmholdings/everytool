import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card, Field, GhostButton, PrimaryButton, Segmented, ToolShell } from '../components/ui';
import { shareText } from '../lib/files';
import {
  cleanUnit,
  dedupeText,
  describeText,
  findReplace,
  pluralWord,
  pullOut,
  removeLineBreaks,
  reverseText,
  sortText,
  toLowerCase,
  toSentenceCase,
  toTitleCase,
  toUpperCase,
  trimSpacing,
  type CleanUnit,
  type ExtractKind,
} from '../lib/text';
import { useStore } from '../store/AppStore';
import { colors, type } from '../theme';

/**
 * Text tools, operating on pasted text. The same operations power the
 * keyboard's Text tab (in Swift), on the draft or the shared clips.
 *
 * Every tap leaves something on screen. Pull-out shows a result card even
 * when nothing matched. Cleanup and case change the box and keep one Undo.
 */

type Anchor = 'field' | 'pull' | 'clean' | 'case' | 'format' | 'replace';

type Panel =
  | { anchor: Anchor; kind: 'list'; title: string; items: string[]; empty: string }
  | { anchor: Anchor; kind: 'note'; title: string; message: string };

function lightTap(): void {
  // Optional native module: an older binary has no ExpoHaptics, and the
  // call rejects instead of taking the screen down.
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function TextScreen({
  onBack,
  notify,
}: {
  onBack: () => void;
  notify: (msg: string) => void;
}) {
  const { addClip } = useStore();
  const [text, setText] = useState('');
  const [undoText, setUndoText] = useState<string | null>(null);
  const [unitChoice, setUnitChoice] = useState<CleanUnit | null>(null);
  const [find, setFind] = useState('');
  const [replaceWith, setReplaceWith] = useState('');
  const [panel, setPanel] = useState<Panel | null>(null);
  const details = useMemo(() => describeText(text), [text]);
  const unit = unitChoice ?? cleanUnit(text);

  const copyOut = async (value: string) => {
    lightTap();
    if (!value.trim()) {
      notify('Nothing to copy');
      setPanel((current) =>
        current?.kind === 'list'
          ? current
          : { anchor: 'field', kind: 'note', title: 'Copy', message: 'Nothing to copy' },
      );
      return;
    }
    await Clipboard.setStringAsync(value);
    addClip(value);
    notify('Copied');
    setPanel((current) =>
      current?.kind === 'list'
        ? current
        : { anchor: 'field', kind: 'note', title: 'Copy', message: 'Copied' },
    );
  };

  const shareOut = async (value: string) => {
    lightTap();
    if (!value.trim()) {
      notify('Nothing to share');
      return;
    }
    const ok = await shareText(value);
    if (!ok) notify('Sharing isn’t available here.');
  };

  const remember = (next: string) => {
    if (next === text) return false;
    setUndoText(text);
    setText(next);
    return true;
  };

  const paste = async () => {
    lightTap();
    const pasted = await Clipboard.getStringAsync();
    if (!pasted) {
      setPanel({ anchor: 'field', kind: 'note', title: 'Paste', message: 'Clipboard is empty' });
      return;
    }
    if (!remember(pasted)) {
      setPanel({
        anchor: 'field',
        kind: 'note',
        title: 'Paste',
        message: 'That text is already in the box',
      });
      return;
    }
    setPanel({
      anchor: 'field',
      kind: 'note',
      title: 'Paste',
      message: 'Pasted from the clipboard',
    });
  };

  const undo = () => {
    lightTap();
    if (undoText === null) return;
    setText(undoText);
    setUndoText(null);
    setPanel({
      anchor: 'field',
      kind: 'note',
      title: 'Undo',
      message: 'Restored the previous text',
    });
  };

  const clearAll = () => {
    lightTap();
    setText('');
    setUndoText(null);
    setUnitChoice(null);
    setFind('');
    setReplaceWith('');
    setPanel({ anchor: 'field', kind: 'note', title: 'Clear', message: 'Cleared' });
  };

  const showPull = (kind: ExtractKind) => {
    lightTap();
    const pulled = pullOut(kind, text);
    setPanel({ anchor: 'pull', kind: 'list', ...pulled });
  };

  const apply = (anchor: Anchor, title: string, next: string, unchanged: string, done: string) => {
    lightTap();
    if (!remember(next)) {
      setPanel({ anchor, kind: 'note', title, message: unchanged });
      return;
    }
    setPanel({ anchor, kind: 'note', title, message: done });
  };

  const useItems = (items: string[]) => {
    lightTap();
    const next = items.join('\n');
    if (!remember(next)) {
      setPanel({
        anchor: 'pull',
        kind: 'note',
        title: 'Use as input',
        message: 'That text is already in the box',
      });
      return;
    }
    setPanel({
      anchor: 'field',
      kind: 'note',
      title: 'Use as input',
      message: 'Replaced the box with the result',
    });
  };

  const runReplace = () => {
    lightTap();
    if (find === '') {
      setPanel({
        anchor: 'replace',
        kind: 'note',
        title: 'Find & replace',
        message: 'Enter text to find',
      });
      return;
    }
    const result = findReplace(text, find, replaceWith);
    if (result.count === 0 || result.text === text) {
      setPanel({
        anchor: 'replace',
        kind: 'note',
        title: 'Find & replace',
        message: result.count === 0 ? 'No matches found' : 'Nothing changed',
      });
      return;
    }
    remember(result.text);
    const noun = pluralWord(result.count, 'match', 'matches');
    setPanel({
      anchor: 'replace',
      kind: 'note',
      title: 'Find & replace',
      message: `Replaced ${result.count} ${noun}`,
    });
  };

  const kept = (next: string): string => {
    if (unit === 'words') {
      const n = next.trim() ? next.trim().split(/\s+/).length : 0;
      return `Kept ${n} ${pluralWord(n, 'word')}`;
    }
    const n = next.split('\n').filter((line) => line.trim().length > 0).length;
    return `Kept ${n} ${pluralWord(n, 'line')}`;
  };

  return (
    <ToolShell title="Text tools" onBack={onBack}>
      <Field
        value={text}
        onChange={(value) => {
          setText(value);
          setUndoText(null);
          setPanel(null);
        }}
        placeholder="Paste or type text"
        multiline
        testID="text.input"
      />
      <GhostButton label="Paste from clipboard" onPress={() => void paste()} />
      {undoText !== null && <GhostButton label="Undo" onPress={undo} />}
      {panel?.anchor === 'field' && (
        <ResultCard panel={panel} onCopy={copyOut} onShare={shareOut} onUse={useItems} />
      )}

      <Card style={styles.counts}>
        <View style={styles.countRow}>
          <Count n={details.words} label={pluralWord(details.words, 'word')} />
          <Count n={details.characters} label={pluralWord(details.characters, 'character')} />
          <Count n={details.lines} label={pluralWord(details.lines, 'line')} />
        </View>
        <View style={styles.countRow}>
          <Count n={details.sentences} label={pluralWord(details.sentences, 'sentence')} />
          <Count n={details.paragraphs} label={pluralWord(details.paragraphs, 'paragraph')} />
          <Count n={details.readingTime} label="reading time" reading />
        </View>
      </Card>

      <Text style={type.label}>Pull out</Text>
      <View style={styles.actionRow}>
        <View style={styles.actionHalf}>
          <PrimaryButton label="Links" onPress={() => showPull('links')} />
        </View>
        <View style={styles.actionHalf}>
          <PrimaryButton label="Emails" onPress={() => showPull('emails')} />
        </View>
      </View>
      <View style={styles.actionRow}>
        <View style={styles.actionHalf}>
          <PrimaryButton label="Phone numbers" onPress={() => showPull('phones')} />
        </View>
        <View style={styles.actionHalf}>
          <PrimaryButton label="Numbers" onPress={() => showPull('numbers')} />
        </View>
      </View>
      <PrimaryButton label="Hashtags & mentions" onPress={() => showPull('tags')} />
      {panel?.anchor === 'pull' && (
        <ResultCard panel={panel} onCopy={copyOut} onShare={shareOut} onUse={useItems} />
      )}

      <Text style={type.label}>Clean up</Text>
      <Segmented
        options={[
          { id: 'lines', label: 'Lines' },
          { id: 'words', label: 'Words' },
        ]}
        value={unit}
        onChange={(next) => {
          lightTap();
          setUnitChoice(next);
        }}
      />
      <PrimaryButton
        label="Remove duplicates"
        onPress={() =>
          apply(
            'clean',
            'Remove duplicates',
            dedupeText(text, unit),
            'No duplicates found',
            kept(dedupeText(text, unit)),
          )
        }
      />
      <View style={styles.actionRow}>
        <View style={styles.actionHalf}>
          <PrimaryButton
            label="Sort A–Z"
            onPress={() =>
              apply('clean', 'Sort A–Z', sortText(text, 'asc', unit), 'Nothing changed', 'Sorted A–Z')
            }
          />
        </View>
        <View style={styles.actionHalf}>
          <PrimaryButton
            label="Sort Z–A"
            onPress={() =>
              apply('clean', 'Sort Z–A', sortText(text, 'desc', unit), 'Nothing changed', 'Sorted Z–A')
            }
          />
        </View>
      </View>
      {panel?.anchor === 'clean' && (
        <ResultCard panel={panel} onCopy={copyOut} onShare={shareOut} onUse={useItems} />
      )}

      <Text style={type.label}>Case</Text>
      <View style={styles.actionRow}>
        <View style={styles.actionHalf}>
          <PrimaryButton
            label="UPPERCASE"
            onPress={() =>
              apply('case', 'UPPERCASE', toUpperCase(text), 'Nothing changed', 'Changed to uppercase')
            }
          />
        </View>
        <View style={styles.actionHalf}>
          <PrimaryButton
            label="lowercase"
            onPress={() =>
              apply('case', 'lowercase', toLowerCase(text), 'Nothing changed', 'Changed to lowercase')
            }
          />
        </View>
      </View>
      <View style={styles.actionRow}>
        <View style={styles.actionHalf}>
          <PrimaryButton
            label="Title Case"
            onPress={() =>
              apply('case', 'Title Case', toTitleCase(text), 'Nothing changed', 'Changed to title case')
            }
          />
        </View>
        <View style={styles.actionHalf}>
          <PrimaryButton
            label="Sentence case"
            onPress={() =>
              apply(
                'case',
                'Sentence case',
                toSentenceCase(text),
                'Nothing changed',
                'Changed to sentence case',
              )
            }
          />
        </View>
      </View>
      {panel?.anchor === 'case' && (
        <ResultCard panel={panel} onCopy={copyOut} onShare={shareOut} onUse={useItems} />
      )}

      <Text style={type.label}>Format</Text>
      <PrimaryButton
        label="Trim extra spaces & empty lines"
        onPress={() =>
          apply('format', 'Trim', trimSpacing(text), 'Nothing changed', 'Trimmed extra spaces and empty lines')
        }
      />
      <View style={styles.actionRow}>
        <View style={styles.actionHalf}>
          <PrimaryButton
            label="Remove line breaks"
            onPress={() =>
              apply(
                'format',
                'Remove line breaks',
                removeLineBreaks(text),
                'Nothing changed',
                'Joined the lines',
              )
            }
          />
        </View>
        <View style={styles.actionHalf}>
          <PrimaryButton
            label="Reverse"
            onPress={() =>
              apply('format', 'Reverse', reverseText(text), 'Nothing changed', 'Reversed the text')
            }
          />
        </View>
      </View>
      {panel?.anchor === 'format' && (
        <ResultCard panel={panel} onCopy={copyOut} onShare={shareOut} onUse={useItems} />
      )}

      <Text style={type.label}>Find & replace</Text>
      <Field value={find} onChange={setFind} placeholder="Find" />
      <Field value={replaceWith} onChange={setReplaceWith} placeholder="Replace with" />
      <PrimaryButton label="Replace" onPress={runReplace} />
      {panel?.anchor === 'replace' && (
        <ResultCard panel={panel} onCopy={copyOut} onShare={shareOut} onUse={useItems} />
      )}

      <View style={styles.footerRow}>
        <View style={styles.actionHalf}>
          <GhostButton label="Copy" onPress={() => void copyOut(text)} />
        </View>
        <View style={styles.actionHalf}>
          <GhostButton label="Clear" onPress={clearAll} />
        </View>
      </View>
    </ToolShell>
  );
}

function Count({ n, label, reading }: { n: number | string; label: string; reading?: boolean }) {
  return (
    <View style={styles.countCell}>
      <Text
        style={[type.num, reading && styles.reading]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      >
        {n}
      </Text>
      <Text style={type.small}>{label}</Text>
    </View>
  );
}

function ResultCard({
  panel,
  onCopy,
  onShare,
  onUse,
}: {
  panel: Panel;
  onCopy: (value: string) => void;
  onShare: (value: string) => void;
  onUse: (items: string[]) => void;
}) {
  if (panel.kind === 'note') {
    return (
      <Card style={styles.foundCard}>
        <Text style={type.label}>{panel.title}</Text>
        <Text style={type.body}>{panel.message}</Text>
      </Card>
    );
  }
  const joined = panel.items.join('\n');
  return (
    <Card style={styles.foundCard}>
      <Text style={type.label}>
        {panel.title} · {panel.items.length}
      </Text>
      {panel.items.length === 0 ? (
        <Text style={type.body}>{panel.empty}</Text>
      ) : (
        panel.items.map((item) => (
          <Text key={item} style={styles.foundItem} onPress={() => onCopy(item)}>
            {item}
          </Text>
        ))
      )}
      {panel.items.length > 0 && (
        <>
          <View style={styles.footerRow}>
            <View style={styles.actionHalf}>
              <GhostButton label="Copy" onPress={() => onCopy(joined)} />
            </View>
            <View style={styles.actionHalf}>
              <GhostButton label="Share" onPress={() => onShare(joined)} />
            </View>
          </View>
          <GhostButton label="Use as input" onPress={() => onUse(panel.items)} />
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  counts: { gap: 14 },
  countRow: { flexDirection: 'row', justifyContent: 'space-between' },
  countCell: { alignItems: 'center', flex: 1, gap: 2 },
  reading: { fontSize: 20 },
  actionRow: { flexDirection: 'row', gap: 10 },
  actionHalf: { flex: 1 },
  foundCard: { gap: 8 },
  foundItem: { fontSize: 15.5, color: colors.accent, paddingVertical: 2 },
  footerRow: { flexDirection: 'row', gap: 10 },
});
