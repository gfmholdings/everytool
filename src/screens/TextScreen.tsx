import * as Clipboard from 'expo-clipboard';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card, Field, GhostButton, PrimaryButton, ToolShell } from '../components/ui';
import {
  countText,
  dedupeLines,
  extractEmails,
  extractLinks,
  extractPhones,
  sortLines,
} from '../lib/text';
import { useStore } from '../store/AppStore';
import { type } from '../theme';

/**
 * Text tools, operating on pasted text. The same operations power the
 * keyboard's Text tab (in Swift), on the draft or the shared clips.
 */
export function TextScreen({
  onBack,
  notify,
}: {
  onBack: () => void;
  notify: (msg: string) => void;
}) {
  const { addClip } = useStore();
  const [text, setText] = useState('');
  const [found, setFound] = useState<{ title: string; items: string[] } | null>(
    null,
  );
  const counts = useMemo(() => countText(text), [text]);

  const show = (title: string, items: string[]) => {
    setFound({ title, items });
    if (items.length === 0) notify(`No ${title.toLowerCase()} found`);
  };

  return (
    <ToolShell title="Text tools" onBack={onBack}>
      <Field
        value={text}
        onChange={setText}
        placeholder="Paste or type text"
        multiline
      />
      <GhostButton
        label="Paste from clipboard"
        onPress={async () => {
          const s = await Clipboard.getStringAsync();
          if (s) setText(s);
        }}
      />

      <Card style={styles.counts}>
        <View style={styles.countCell}>
          <Text style={type.num}>{counts.words}</Text>
          <Text style={type.small}>words</Text>
        </View>
        <View style={styles.countCell}>
          <Text style={type.num}>{counts.characters}</Text>
          <Text style={type.small}>characters</Text>
        </View>
        <View style={styles.countCell}>
          <Text style={type.num}>{counts.lines}</Text>
          <Text style={type.small}>lines</Text>
        </View>
      </Card>

      <Text style={type.label}>Pull out</Text>
      <View style={styles.actionRow}>
        <View style={styles.actionHalf}>
          <PrimaryButton label="Links" onPress={() => show('Links', extractLinks(text))} />
        </View>
        <View style={styles.actionHalf}>
          <PrimaryButton label="Emails" onPress={() => show('Emails', extractEmails(text))} />
        </View>
      </View>
      <PrimaryButton
        label="Phone numbers"
        onPress={() => show('Phone numbers', extractPhones(text))}
      />

      <Text style={type.label}>Clean up</Text>
      <View style={styles.actionRow}>
        <View style={styles.actionHalf}>
          <PrimaryButton
            label="Remove duplicates"
            onPress={() => setText((t) => dedupeLines(t))}
          />
        </View>
        <View style={styles.actionHalf}>
          <PrimaryButton
            label="Sort A–Z"
            onPress={() => setText((t) => sortLines(t, 'asc'))}
          />
        </View>
      </View>
      <GhostButton
        label="Sort Z–A"
        onPress={() => setText((t) => sortLines(t, 'desc'))}
      />

      {found && found.items.length > 0 && (
        <Card style={styles.foundCard}>
          <Text style={type.label}>
            {found.title} · {found.items.length}
          </Text>
          {found.items.map((item) => (
            <Text
              key={item}
              style={styles.foundItem}
              onPress={() =>
                void Clipboard.setStringAsync(item).then(() => notify('Copied'))
              }
            >
              {item}
            </Text>
          ))}
        </Card>
      )}

      <View style={styles.footerRow}>
        <View style={styles.actionHalf}>
          <GhostButton
            label="Copy text"
            onPress={() =>
              void Clipboard.setStringAsync(text).then(() => notify('Copied'))
            }
          />
        </View>
        <View style={styles.actionHalf}>
          <GhostButton
            label="Save to clipboard"
            onPress={() => {
              if (addClip(text)) notify('Saved to clipboard history');
            }}
          />
        </View>
      </View>
    </ToolShell>
  );
}

const styles = StyleSheet.create({
  counts: { flexDirection: 'row', justifyContent: 'space-between' },
  countCell: { alignItems: 'center', flex: 1, gap: 2 },
  actionRow: { flexDirection: 'row', gap: 10 },
  actionHalf: { flex: 1 },
  foundCard: { gap: 8 },
  foundItem: { fontSize: 15.5, color: '#007AFF', paddingVertical: 2 },
  footerRow: { flexDirection: 'row', gap: 10 },
});
