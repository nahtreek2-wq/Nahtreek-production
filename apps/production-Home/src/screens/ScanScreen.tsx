import React, {useCallback, useEffect, useState} from 'react';
import {View, Text, StyleSheet, TextInput, ScrollView} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useMutation} from '@tanstack/react-query';
import {Colors, Typography, Spacing} from '@nahtreek/design-system';
import {AppHeader, Button, Card} from '../components/ui';
import {KeyboardAwareView} from '../../../../packages/mobile-ui/KeyboardAwareView';
import {api} from '../services/apiClient';
import {useToast} from '../stores/toast';
import type {RootStackParamList} from '../navigation/types';

// Optional native dependency: the screen works without it (manual code +
// system camera), and lights up the live viewfinder when installed.
let VisionCamera: {Camera: any; useCameraDevice: any; useCodeScanner: any} | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  VisionCamera = require('react-native-vision-camera');
} catch {
  VisionCamera = null;
}

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function parseReviewQr(value: string): string | null {
  const text = value.trim();
  const https = text.match(/\/p\/([0-9a-fA-F-]{8,36})\/?(?:[?#].*)?$/);
  if (https) return https[1];
  const scheme = text.match(/^nahtreek:\/\/(?:p|r(?:eviews)?)\/([0-9a-fA-F-]{8,36})\/?$/);
  if (scheme) return scheme[1];
  return null;
}

export function parsePayQr(value: string): string | null {
  const text = value.trim();
  const scheme = text.match(/^nahtreek:\/\/pay\/([0-9a-fA-F-]{8,36})\/?$/);
  return scheme ? scheme[1] : null;
}

export function ScanScreen() {
  const navigation = useNavigation<Nav>();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const open = useCallback((professionalProfileId: string) => {
    navigation.navigate('ProviderProfile', {professionalProfileId});
  }, [navigation]);
  const openPayment = useCallback((requestId: string) => {
    navigation.navigate('RequestDetail', {requestId});
  }, [navigation]);

  useEffect(() => {
    if (!VisionCamera?.Camera?.getCameraPermissionStatus) return;
    try {
      // v4 returns the status synchronously; only the request is async.
      const status: string = VisionCamera.Camera.getCameraPermissionStatus();
      if (status === 'granted') {
        setPermission('granted');
        return;
      }
      VisionCamera.Camera.requestCameraPermission().then((next: string) =>
        setPermission(next === 'granted' ? 'granted' : 'denied')).catch(() => setPermission('denied'));
    } catch {
      setPermission('denied');
    }
  }, []);

  const resolveCode = useMutation({mutationFn: (raw: string) =>
    api.get<{professionalProfileId: string}>(`/discovery/providers/by-code/${raw.trim().toUpperCase()}`),
    onSuccess: data => open(data.professionalProfileId),
    onError: error => toast(error instanceof Error ? error.message : 'Code not recognized. Check it and try again.', 'error')});

  return <KeyboardAwareView style={styles.root}>
    <AppHeader title="Scan pro QR" onBack={() => navigation.goBack()} />
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      {VisionCamera ? <LiveScanner permission={permission} onDetect={open} onPayDetect={openPayment} /> : (
        <Card>
          <Text style={styles.title}>Point your phone camera at the QR</Text>
          <Text style={styles.text}>Use your normal camera app — the link opens this professional&apos;s ratings page directly. No separate scanner needed.</Text>
        </Card>
      )}
      <Card>
        <Text style={styles.title}>Or type the 6-character code</Text>
        <Text style={styles.text}>It is printed under the QR on the professional&apos;s phone.</Text>
        <TextInput accessibilityLabel="6-character review code" style={styles.input} placeholder="e.g. KX7Q2M"
          placeholderTextColor={Colors.slate500} autoCapitalize="characters" autoCorrect={false} maxLength={6}
          value={code} onChangeText={setCode} />
        <Button label={resolveCode.isPending ? 'Checking…' : 'Open ratings'} disabled={code.trim().length < 6 || resolveCode.isPending}
          onPress={() => resolveCode.mutate(code)} />
      </Card>
    </ScrollView>
  </KeyboardAwareView>;
}

function LiveScanner({permission, onDetect, onPayDetect}: {permission: string; onDetect: (id: string) => void; onPayDetect: (requestId: string) => void}) {
  const device = VisionCamera!.useCameraDevice('back');
  const handled = React.useRef(new Set<string>());
  const scanner = VisionCamera!.useCodeScanner({codeTypes: ['qr'], onCodeScanned: (codes: {value?: string}[]) => {
    for (const item of codes) {
      if (!item.value || handled.current.has(item.value)) continue;
      const payId = parsePayQr(item.value);
      if (payId) {
        handled.current.add(item.value);
        onPayDetect(payId);
        return;
      }
      const id = parseReviewQr(item.value);
      if (!id) continue;
      handled.current.add(item.value);
      onDetect(id);
      return;
    }
  }});
  if (permission === 'unknown') return <Card><Text style={styles.text}>Requesting camera access…</Text></Card>;
  if (permission !== 'granted' || !device) return (
    <Card>
      <Text style={styles.title}>Camera unavailable</Text>
      <Text style={styles.text}>Allow camera access in Settings, or type the 6-character code below instead.</Text>
    </Card>
  );
  const CameraView = VisionCamera!.Camera;
  return <View style={styles.viewfinder}>
    <CameraView style={StyleSheet.absoluteFill} device={device} isActive codeScanner={scanner} />
    <View pointerEvents="none" style={styles.frame} />
    <Text style={styles.scanHint}>Point at the professional&apos;s QR</Text>
  </View>;
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: Colors.offWhite},
  body: {padding: Spacing.md, gap: Spacing.md},
  title: {fontSize: 17, fontWeight: '800', color: Colors.navyDeep},
  text: {...Typography.body, color: Colors.slate600},
  input: {minHeight: 52, padding: 12, borderWidth: 1, borderColor: Colors.slate200, borderRadius: 12,
    color: Colors.slate900, fontSize: 20, fontWeight: '800', letterSpacing: 4, textAlign: 'center', marginVertical: Spacing.sm},
  viewfinder: {height: 320, borderRadius: 16, overflow: 'hidden', backgroundColor: Colors.navyDeep},
  frame: {position: 'absolute', left: '18%', right: '18%', top: '14%', bottom: '22%',
    borderWidth: 3, borderColor: Colors.amber, borderRadius: 16},
  scanHint: {position: 'absolute', bottom: 12, left: 0, right: 0, textAlign: 'center', color: Colors.white, fontWeight: '700'},
});
