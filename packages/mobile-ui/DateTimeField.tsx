import React, {useState} from 'react';
import {Platform, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';

// Optional native module: present in both app builds, but the field stays
// usable (plain text entry) if linking ever misses it.
let NativePicker: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  NativePicker = require('@react-native-community/datetimepicker').default;
} catch {
  NativePicker = null;
}

function formatDate(value: Date): string {
  return value.toLocaleDateString('en-IN', {day: 'numeric', month: 'short', year: 'numeric'});
}

function formatTime(value: Date): string {
  return value.toLocaleTimeString('en-IN', {hour: 'numeric', minute: '2-digit'});
}

function formatDateTime(value: Date): string {
  return `${formatDate(value)} · ${formatTime(value)}`;
}

function parseFallback(text: string): Date | null {
  const parts = text.trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!parts) return null;
  return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), Number(parts[4]), Number(parts[5]));
}

export function DateTimeField({label, value, onChange, minimumDate, maximumDate, mode = 'datetime', accessibilityLabel}: {
  label: string;
  value: Date | null;
  onChange: (value: Date | null) => void;
  minimumDate?: Date;
  maximumDate?: Date;
  mode?: 'datetime' | 'date' | 'time';
  accessibilityLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<'date' | 'time'>('date');
  const [draft, setDraft] = useState('');

  if (!NativePicker) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.label}>{label}</Text>
        <TextInput
          accessibilityLabel={accessibilityLabel ?? label}
          style={styles.input}
          placeholder={mode === 'time' ? 'HH:mm' : 'YYYY-MM-DD HH:mm'}
          value={draft}
          onChangeText={text => {
            setDraft(text);
            onChange(mode === 'datetime' ? parseFallback(text) : null);
          }}
        />
      </View>
    );
  }

  const shown = mode === 'datetime' && Platform.OS === 'android' ? stage : mode;
  const displayValue = value ?? minimumDate ?? new Date();
  const text = !value ? `Choose ${label.toLowerCase()}` : mode === 'date' ? formatDate(value) : mode === 'time' ? formatTime(value) : formatDateTime(value);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        onPress={() => { setStage('date'); setOpen(true); }}
        style={styles.field}>
        <Text style={[styles.fieldText, !value && styles.placeholder]}>{text}</Text>
      </Pressable>
      {open ? (
        <NativePicker
          value={displayValue}
          mode={shown}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          onChange={(event: {type: string}, selected?: Date) => {
            if (event.type === 'dismissed' || !selected) {
              setOpen(false);
              setStage('date');
              return;
            }
            if (shown === 'date' && mode === 'datetime' && Platform.OS === 'android') {
              // Android has no combined picker: keep the picked day, then ask
              // for the time, seeding from the previous value when present.
              const merged = new Date(selected);
              if (value) {
                merged.setHours(value.getHours(), value.getMinutes(), 0, 0);
              }
              onChange(merged);
              setStage('time');
              return;
            }
            if (shown === 'time' && mode === 'datetime' && value) {
              const merged = new Date(value);
              merged.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
              onChange(merged);
            } else {
              onChange(selected);
            }
            setOpen(false);
            setStage('date');
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {gap: 6},
  label: {fontSize: 14, fontWeight: '600', color: '#111F35'},
  field: {minHeight: 52, paddingHorizontal: 12, justifyContent: 'center', borderWidth: 1, borderColor: '#D7DEE8', borderRadius: 12, backgroundColor: '#FFFFFF'},
  fieldText: {fontSize: 16, color: '#111F35'},
  placeholder: {color: '#8A94A6'},
  input: {minHeight: 52, paddingHorizontal: 12, borderWidth: 1, borderColor: '#D7DEE8', borderRadius: 12, fontSize: 16, color: '#111F35', backgroundColor: '#FFFFFF'},
});
