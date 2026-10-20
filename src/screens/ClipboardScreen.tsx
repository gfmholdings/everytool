import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppState as RNAppState,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Card, Field, GhostButton, PrimaryButton, ToolShell } from '../components/ui';
import { sortedClips, useStore } from '../store/AppStore';
import { colors, type } from '../theme';
import type { Clip } from '../types';

/**
 * The clipboard vault. The same clips live in the App Group store, so the
 * keyboard's Clipboard tab shows — and edits — this exact list. Every
 * clip can be copied, edited, pinned, shared, cut (copy + remove) or
 * deleted; the system clipboard can be saved or pasted into a new clip.
 */
export function ClipboardScreen({
  onBack,
  notify,
}: {
  onBack: () => void;
  notify: (msg: string) => void;
}) {
  const {
    state,
    addClip,
    updateClip,
    setClipShortcut,
    togglePin,
    deleteClip,
    clearUnpinnedClips,
    refresh,
  } = useStore();
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string; shortcut: string } | null>(
    null,
  );
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);

  const readSystemClipboard = useCallback(async () => {
    try {
      const has = await Clipboard.hasStringAsync();
      if (!has) {
        setCurrent(null);
        return;
      }
      const s = await Clipboard.getStringAsync();
      setCurrent(s.trim() ? s : null);
    } catch {
      setCurrent(null);
    }
  }, []);

  // Keep in step with the keyboard (it writes the same vault) and with
  // whatever the user copied elsewhere.
  useEffect(() => {
    const first = setTimeout(() => void readSystemClipboard(), 0);
    const timer = setInterval(refresh, 1500);
    const sub = RNAppState.addEventListener('change', (s) => {
      if (s === 'active') {
        refresh();
        void readSystemClipboard();
      }
    });
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      sub.remove();
    };
  }, [refresh, readSystemClipboard]);

  const clips = useMemo(() => {
    const all = sortedClips(state.clips);
    const q = query.trim().toLowerCase();
    return q ? all.filter((c) => c.text.toLowerCase().includes(q)) : all;
  }, [state.clips, query]);

  const save = (text: string) => {
    if (addClip(text)) {
      notify('Saved to clipboard history');
      setDraft('');
    }
  };

  const copy = async (clip: Clip) => {
    await Clipboard.setStringAsync(clip.text);
    setCurrent(clip.text);
    notify('Copied');
  };

  const cut = async (clip: Clip) => {
    await Clipboard.setStringAsync(clip.text);
    setCurrent(clip.text);
    deleteClip(clip.id);
    notify('Cut — it’s on your clipboard');
  };

  const confirmClear = () => {
    Alert.alert('Clear clipboard history?', 'Pinned clips are kept.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          clearUnpinnedClips();
          notify('Cleared');
        },
      },
    ]);
  };

  const currentSaved = current != null && state.clips.some((c) => c.text === current.trim());
  const unpinnedCount = state.clips.filter((c) => !c.pinned).length;

  return (
    <ToolShell title="Clipboard" onBack={onBack}>
      {current && !currentSaved && (
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
        testID="clipboard.draft"
      />
      <View style={styles.row}>
        <View style={styles.half}>
          <PrimaryButton
            label="Save text"
            onPress={() => save(draft)}
            disabled={!draft.trim()}
          />
        </View>
        <View style={styles.half}>
          <GhostButton
            label="Paste"
            onPress={async () => {
              const s = await Clipboard.getStringAsync();
              if (s) setDraft((d) => (d ? `${d}${s}` : s));
              else notify('Clipboard is empty');
            }}
          />
        </View>
      </View>

      {state.clips.length > 4 && (
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search clips"
          placeholderTextColor={colors.faint}
          style={styles.search}
          clearButtonMode="while-editing"
          testID="clipboard.search"
        />
      )}

      {clips.length === 0 ? (
        <Text style={type.small}>
          {query
            ? 'No clips match.'
            : 'Nothing saved yet. Saved clips also appear in the Everytool keyboard, in every app — and anything you save there shows up here.'}
        </Text>
      ) : (
        clips.map((clip) =>
          editing?.id === clip.id ? (
            <Card key={clip.id} style={styles.editCard}>
              <Field
                value={editing.text}
                onChange={(text) => setEditing({ ...editing, text })}
                multiline
                testID="clipboard.edit"
              />
              <Text style={type.label}>Snippet word (optional)</Text>
              <TextInput
                value={editing.shortcut}
                onChangeText={(shortcut) => {
                  setShortcutError(null);
                  setEditing({ ...editing, shortcut });
                }}
                placeholder="e.g. addr — type it + space in the Everytool keyboard"
                placeholderTextColor={colors.faint}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.search}
                testID="clipboard.shortcut"
              />
              {!!shortcutError && <Text style={styles.error}>{shortcutError}</Text>}
              <View style={styles.row}>
                <View style={styles.half}>
                  <GhostButton label="Cancel" onPress={() => setEditing(null)} />
                </View>
                <View style={styles.half}>
                  <PrimaryButton
                    label="Save"
                    disabled={!editing.text.trim()}
                    onPress={() => {
                      const problem = setClipShortcut(clip.id, editing.shortcut);
                      if (problem) {
                        setShortcutError(problem);
                        return;
                      }
                      updateClip(clip.id, editing.text);
                      setEditing(null);
                      notify('Clip updated');
                    }}
                  />
                </View>
              </View>
            </Card>
          ) : (
            <Card key={clip.id} style={styles.clipCard}>
              <Pressable
                accessibilityLabel={`Copy ${clip.text}`}
                onPress={() => void copy(clip)}
              >
                <Text style={type.body} numberOfLines={4}>
                  {clip.text}
                </Text>
                <Text style={[type.small, styles.meta]}>
                  {new Date(clip.createdAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                  {clip.pinned ? ' · pinned' : ''}
                  {clip.shortcut ? ` · type “${clip.shortcut}” + space in the keyboard` : ''} · tap to copy
                </Text>
              </Pressable>
              <View style={styles.actions}>
                <Action label="Copy" onPress={() => void copy(clip)} />
                <Action
                  label="Edit"
                  onPress={() => {
                    setShortcutError(null);
                    setEditing({ id: clip.id, text: clip.text, shortcut: clip.shortcut ?? '' });
                  }}
                />
                <Action
                  label={clip.pinned ? 'Unpin' : 'Pin'}
                  active={clip.pinned}
                  onPress={() => togglePin(clip.id)}
                />
                <Action
                  label="Share"
                  onPress={() => void Share.share({ message: clip.text })}
                />
                <Action label="Cut" onPress={() => void cut(clip)} />
                <Action label="Delete" danger onPress={() => deleteClip(clip.id)} />
              </View>
            </Card>
          ),
        )
      )}

      {unpinnedCount > 0 && !query && (
        <GhostButton label="Clear unpinned clips" onPress={confirmClear} />
      )}
    </ToolShell>
  );
}

function Action({
  label,
  onPress,
  danger,
  active,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        active && styles.actionActive,
        pressed && { opacity: 0.6 },
      ]}
    >
      <Text
        style={[
          styles.actionLabel,
          danger && { color: colors.danger },
          active && { color: '#FFFFFF' },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  currentCard: { gap: 10, backgroundColor: colors.accentSoft },
  clipText: { marginTop: 2 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  half: { flex: 1 },
  search: {
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.ink,
  },
  clipCard: { gap: 10 },
  editCard: { gap: 10 },
  meta: { marginTop: 4 },
  error: { color: colors.danger, fontSize: 14 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  action: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 9,
    backgroundColor: colors.bg,
  },
  actionActive: { backgroundColor: colors.accent },
  actionLabel: { fontSize: 14, fontWeight: '600', color: colors.accent },
});
