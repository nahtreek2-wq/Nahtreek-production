import React, {useEffect, useState} from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import {ProColors} from '../theme/professionalTheme';
import {mediaUrl} from '../services/media';

// Soft deterministic tints so every client reads as a distinct person even
// when they never uploaded a photo. Dark text on light tints only.
const FALLBACK_TINTS = [
  {background: ProColors.blueSoft, foreground: ProColors.primary},
  {background: ProColors.accentSoft, foreground: ProColors.accentText},
  {background: ProColors.successSoft, foreground: ProColors.success},
  {background: '#F3E8FF', foreground: '#6D28D9'},
  {background: '#FFEEDD', foreground: '#9A3412'},
  {background: '#E0F2F1', foreground: '#0F766E'},
] as const;

function tintFor(name: string): {background: string; foreground: string} {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 2147483647;
  }
  return FALLBACK_TINTS[Math.abs(hash) % FALLBACK_TINTS.length];
}

/** Client face for job rows: real photo when the client uploaded one, else a
 * stable tinted initial so rows never show a blank box. */
export function ClientAvatar({name, avatarUrl, size = 48}: {
  name?: string;
  avatarUrl?: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const uri = mediaUrl(avatarUrl);
  useEffect(() => setFailed(false), [avatarUrl]);
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const tint = tintFor(name || '?');
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.frame, {width: size, height: size, borderRadius: size / 2, backgroundColor: tint.background}]}>
      {uri && !failed ? (
        <Image
          source={{uri}}
          style={[styles.image, {borderRadius: size / 2}]}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Text style={[styles.initial, {fontSize: Math.round(size * 0.42), color: tint.foreground}]}>
          {initial}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: ProColors.slateSoft},
  image: {width: '100%', height: '100%'},
  initial: {fontWeight: '700', color: ProColors.primary},
});
