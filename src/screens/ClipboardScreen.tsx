import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, Field, PrimaryButton, ToolShell } from '../components/ui';
import { sortedClips, useStore } from '../store/AppStore';
import { colors, type } from '../theme';

/**
 * The clipboard vault. The same clips live in the App Group store, so the
 * keyboard's Clipboard tab shows this exact list. Tap copies; the row's
 * pin keeps an item at the top.
 */
export function ClipboardScreen({
  onBack,
  notify,
}: {
  onBack: () => void;
  notify: (msg: string) => void;
}) {
  const { state, addClip, togglePin, deleteClip } = useStore();
  const [draft, setDraft] = useState('');
  const clips = sortedClips(state.clips);

  // Offer whatever is on the system clipboard right now as a one-tap save.
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void Clipboard.getStringAsync().then((s) => {
      if (live && s.trim()) setCurrent(s);
    });
    return () => {
      live = false;
    };
  }, []);

  const save = (text: string) => {
    if (addClip(text)) {
      notify('Saved to clipboard history');
      setDraft('');
      setCurrent(null);
    }
  };

  return (
    <ToolShell title="Clipboard" onBack={onBack}>
      {current && !clips.some((c) => c.text === current.trim()) && (
        <Card style={styles.currentCard}>
          <Text style={type.label}>On your clipboard now</Text>
          <Text style={[type.body, styles.clipText]} numberOfLines={3}>
            {current}
          </Text>
          <PrimaryButton label="Save it" onPress={() => save(current)} />
        </Card>
      )}

      <Field
        value={draft}
        onChange={setDraft}
        placeholder="Type or paste something to keep"
        multiline
      />
      <PrimaryButton
        label="Save text"
        onPress={() => save(draft)}
        disabled={!draft.trim()}
      />

      {clips.length === 0 ? (
        <Text style={type.small}>
          Nothing saved yet. Saved clips also appear in the Everytool
          keyboard, in every app.
        </Text>
      ) : (
        clips.map((clip) => (
          <Pressable
            key={clip.id}
            onPress={async () => {
              await Clipboard.setStringAsync(clip.text);
              notify('Copied');
            }}
          >
            <Card style={styles.clipRow}>
              <View style={styles.clipMain}>
                <Text style={type.body} numberOfLines={3}>
                  {clip.text}
                </Text>
                <Text style={type.small}>
                  {new Date(clip.createdAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                  {clip.pinned ? ' · pinned' : ''}
                </Text>
              </View>
              <View style={styles.clipActions}>
                <Pressable
                  accessibilityLabel={clip.pinned ? 'Unpin' : 'Pin'}
                  onPress={() => togglePin(clip.id)}
                  style={styles.iconButton}
                >
                  <Text
                    style={[
                      styles.pinGlyph,
                      clip.pinned && { color: colors.accent },
                    ]}
                  >
                    📌
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Delete clip"
                  onPress={() => deleteClip(clip.id)}
                  style={styles.iconButton}
                >
                  <Text style={styles.deleteGlyph}>✕</Text>
                </Pressable>
              </View>
            </Card>
          </Pressable>
        ))
      )}
    </ToolShell>
  );
}

const styles = StyleSheet.create({
  currentCard: { gap: 10, backgroundColor: colors.accentSoft },
  clipText: { marginTop: 2 },
  clipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  clipMain: { flex: 1, gap: 4 },
  clipActions: { flexDirection: 'row' },
  iconButton: { padding: 6 },
  pinGlyph: { fontSize: 15, color: colors.faint },
  deleteGlyph: { fontSize: 16, color: colors.faint },
});
