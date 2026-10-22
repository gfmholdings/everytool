import type { ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect, Circle } from 'react-native-svg';

import { useTheme } from '../useTheme';
import { space, type Palette } from '../theme';
import type { ToolId } from '../types';

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { palette } = useTheme();
  return (
    <View style={[stylesOf(palette).card, style]}>{children}</View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const { palette } = useTheme();
  const styles = stylesOf(palette);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primary,
        { backgroundColor: palette.primary },
        pressed && { opacity: 0.75 },
        disabled && { opacity: 0.4 },
      ]}
    >
      <Text style={styles.primaryLabel}>{label}</Text>
    </Pressable>
  );
}

export function GhostButton({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  const { palette } = useTheme();
  const styles = stylesOf(palette);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.6 }]}
    >
      <Text style={styles.ghostLabel}>{label}</Text>
    </Pressable>
  );
}

export type UndoControls = {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
};

/** A screen for one tool: title, undo and redo when the tool edits, one action zone. */
export function ToolShell({
  title,
  onBack,
  undo,
  children,
}: {
  title: string;
  onBack: () => void;
  undo?: UndoControls;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { palette, type } = useTheme();
  const styles = stylesOf(palette);
  return (
    <View style={[styles.shell, { paddingTop: insets.top }]}>
      <View style={styles.shellHeader}>
        <Pressable accessibilityLabel="Back" onPress={onBack} style={styles.backButton}>
          <Text style={styles.backChevron}>‹</Text>
        </Pressable>
        <Text style={[type.h2, styles.title]}>{title}</Text>
        <View style={styles.undoSlot}>
          {undo && (
            <>
              <Pressable
                accessibilityLabel="Undo"
                accessibilityState={{ disabled: !undo.canUndo }}
                disabled={!undo.canUndo}
                onPress={undo.onUndo}
                hitSlop={6}
                style={styles.undoButton}
              >
                <Text style={[styles.undoIcon, !undo.canUndo && styles.undoOff]}>↩</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Redo"
                accessibilityState={{ disabled: !undo.canRedo }}
                disabled={!undo.canRedo}
                onPress={undo.onRedo}
                hitSlop={6}
                style={styles.undoButton}
              >
                <Text style={[styles.undoIcon, !undo.canRedo && styles.undoOff]}>↪</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.shellBody} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </View>
  );
}

export function Field({
  value,
  onChange,
  placeholder,
  keyboard,
  multiline,
  mono,
  testID,
  secure,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboard?: 'decimal-pad' | 'number-pad' | 'phone-pad' | 'email-address' | 'default';
  multiline?: boolean;
  mono?: boolean;
  testID?: string;
  secure?: boolean;
}) {
  const { palette } = useTheme();
  const styles = stylesOf(palette);
  return (
    <TextInput
      testID={testID}
      accessibilityLabel={placeholder}
      secureTextEntry={secure}
      autoCapitalize={keyboard === 'email-address' ? 'none' : undefined}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={palette.textSecondary}
      keyboardType={keyboard ?? 'default'}
      multiline={multiline}
      style={[styles.field, multiline && styles.fieldMulti, mono && { fontFamily: 'Menlo' }]}
    />
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const { palette } = useTheme();
  const styles = stylesOf(palette);
  return (
    <View style={styles.segmented}>
      {options.map((o) => {
        const active = o.id === value;
        return (
          <Pressable
            key={o.id}
            accessibilityRole="button"
            onPress={() => onChange(o.id)}
            style={[styles.segItem, active && styles.segItemActive]}
          >
            <Text style={[styles.segLabel, active && styles.segLabelActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The ten tool glyphs, drawn the same way the mockup draws them. */
export function ToolGlyph({ id, size = 24 }: { id: ToolId; size?: number }) {
  const { palette } = useTheme();
  const stroke = palette.onPrimary;
  const sw = 1.8;
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke,
    strokeWidth: sw,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (id) {
    case 'stitch':
      return (
        <Svg {...common}>
          <Rect x="7" y="3" width="10" height="18" rx="2" />
          <Path d="M10 8l2-2 2 2M10 16l2 2 2-2" />
        </Svg>
      );
    case 'clipboard':
      return (
        <Svg {...common}>
          <Rect x="6" y="4" width="12" height="17" rx="2" />
          <Path d="M9 4.5V3h6v1.5M9.5 10h5M9.5 13.5h5M9.5 17h3" />
        </Svg>
      );
    case 'convert':
      return (
        <Svg {...common}>
          <Path d="M4 8a8 8 0 0 1 13.6-3M20 16a8 8 0 0 1-13.6 3" />
          <Path d="M17.5 2.5v3h-3M6.5 21.5v-3h3" />
        </Svg>
      );
    case 'qr':
      return (
        <Svg {...common}>
          <Rect x="3.5" y="3.5" width="7" height="7" rx="1" />
          <Rect x="13.5" y="3.5" width="7" height="7" rx="1" />
          <Rect x="3.5" y="13.5" width="7" height="7" rx="1" />
          <Path d="M13.5 13.5h3v3h-3zM17.5 17.5h3v3h-3z" />
        </Svg>
      );
    case 'resize':
      return (
        <Svg {...common}>
          <Rect x="3.5" y="3.5" width="17" height="17" rx="2" />
          <Path d="M15 9l-5.5 5.5M9.5 9H15v5.5" />
        </Svg>
      );
    case 'pdf':
      return (
        <Svg {...common}>
          <Path d="M6 3h8l4 4v14H6z" />
          <Path d="M14 3v4h4M9 13.5c1-1.5 4-1.5 6 0M9.5 17.5c1.5-1 4-1 5.5.5" />
        </Svg>
      );
    case 'text':
      return (
        <Svg {...common}>
          <Path d="M4 6h16M4 11h10M4 16h16M4 21h7" />
        </Svg>
      );
    case 'days':
      return (
        <Svg {...common}>
          <Rect x="3.5" y="5" width="17" height="16" rx="2" />
          <Path d="M3.5 10h17M8 3v4M16 3v4" />
        </Svg>
      );
    case 'split':
      return (
        <Svg {...common}>
          <Circle cx="9" cy="8.5" r="3" />
          <Circle cx="17" cy="10" r="2.4" />
          <Path d="M4 20c.6-3 2.6-4.5 5-4.5s4.4 1.5 5 4.5M15.5 15.8c2 .2 3.4 1.6 3.9 4.2" />
        </Svg>
      );
    case 'gif':
      return (
        <Svg {...common}>
          <Rect x="3.5" y="5" width="13" height="13" rx="2" />
          <Path d="M16.5 9.5l4-2.5v10l-4-2.5" />
          <Circle cx="10" cy="11.5" r="2.4" />
        </Svg>
      );
  }
}

function stylesOf(p: Palette) {
  return StyleSheet.create({
    card: {
      backgroundColor: p.surface,
      borderRadius: space.radius,
      padding: space.cardPad,
    },
    primary: {
      borderRadius: 14,
      paddingVertical: 15,
      alignItems: 'center',
    },
    primaryLabel: { color: p.onPrimary, fontSize: 17, fontWeight: '700' },
    ghost: { paddingVertical: 10, alignItems: 'center' },
    ghostLabel: { color: p.primary, fontSize: 16, fontWeight: '600' },
    shell: { flex: 1, backgroundColor: p.background },
    shellHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      paddingTop: 8,
      paddingBottom: 4,
      gap: 4,
    },
    backButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    backChevron: { fontSize: 34, color: p.primary, marginTop: -4 },
    title: { flex: 1 },
    undoSlot: { flexDirection: 'row', minWidth: 44, justifyContent: 'flex-end' },
    undoButton: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
    undoIcon: { fontSize: 22, color: p.primary, fontWeight: '700' },
    undoOff: { opacity: 0.28 },
    shellBody: { padding: space.screen, gap: space.gap, paddingBottom: 40 },
    field: {
      backgroundColor: p.surface,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 16,
      color: p.textPrimary,
    },
    fieldMulti: { minHeight: 140, textAlignVertical: 'top' },
    segmented: {
      flexDirection: 'row',
      backgroundColor: p.secondary,
      borderRadius: 12,
      padding: 2,
      gap: 2,
    },
    segItem: {
      flex: 1,
      paddingVertical: 9,
      borderRadius: 10,
      alignItems: 'center',
    },
    segItemActive: { backgroundColor: p.surface },
    segLabel: { fontSize: 14.5, fontWeight: '600', color: p.textSecondary },
    segLabelActive: { color: p.textPrimary },
  });
}
