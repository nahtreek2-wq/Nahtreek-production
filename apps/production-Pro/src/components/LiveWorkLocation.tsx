import React, {useState} from 'react';
import {NativeModules, Platform, Pressable, StyleSheet, Text, View} from 'react-native';
import {useQuery} from '@tanstack/react-query';
import {useSessionStore} from '../stores/session';
import {allowLiveLocation, publishCurrentLocation} from '../services/liveLocation';
import {Colors} from '@nahtreek/design-system';
import {WorkVisual} from './WorkVisual';
import {ProColors, ProType} from '../theme/professionalTheme';

type LiveWorkLocationProps = {
  verified: boolean;
  verificationStatus: string;
  statusUnknown: boolean;
  statusChecking: boolean;
  available?: boolean;
  onManageAvailability: () => void;
};

export function LiveWorkLocation({verified, verificationStatus, statusUnknown, statusChecking, available, onManageAvailability}: LiveWorkLocationProps) {
  const token = useSessionStore(state => state.accessToken);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const query = useQuery({
    queryKey: ['live-work-location'],
    queryFn: () => NativeModules.NahtreekRuntimeConfig.liveLocationStatus() as Promise<{running: boolean; error?: string}>,
    refetchInterval: 5000,
    enabled: verified && (Platform.OS === 'android' || Platform.OS === 'ios'),
  });

  async function toggle() {
    if (!verified || (available !== true && !query.data?.running)) {return;}
    setBusy(true);
    setError('');
    try {
      if (query.data?.running) {
        await NativeModules.NahtreekRuntimeConfig.stopLiveLocation();
      } else {
        await allowLiveLocation();
        await publishCurrentLocation();
        await NativeModules.NahtreekRuntimeConfig.startLiveLocation(token);
      }
      await query.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update location sharing');
    } finally {
      setBusy(false);
    }
  }

  if (!verified) {
    const title = statusChecking
      ? 'Checking approval status'
      : statusUnknown
      ? 'Approval status unavailable'
      : verificationStatus === 'UNDER_REVIEW'
      ? 'Verification is being reviewed'
      : 'Location sharing unlocks after approval';
    const copy = statusChecking
      ? 'Location stays off until we confirm your profile is approved.'
      : statusUnknown
      ? 'Refresh your profile to confirm approval. Location stays off until the server confirms your status.'
      : verificationStatus === 'UNDER_REVIEW'
      ? 'Your documents are with our team. After approval, you can choose to share live location for nearby service work.'
      : verificationStatus === 'REJECTED'
      ? 'Update your verification details. Nearby location sharing becomes available once your profile is approved.'
      : 'Complete verification first. After approval and when available for work, you can choose to share your location.';
    return <View style={styles.card}>
      <View style={styles.heading}><WorkVisual kind="verification" size={42} /><View style={styles.flex}><Text style={styles.title}>{title}</Text><Text style={styles.copy}>{copy}</Text></View></View>
    </View>;
  }

  if (available !== true && !query.data?.running) {
    return <View style={styles.card}>
      <View style={styles.heading}><WorkVisual kind="location" size={42} /><View style={styles.flex}><Text style={styles.title}>{available === false ? 'Turn on work availability first' : 'Checking work availability'}</Text><Text style={styles.copy}>{available === false ? 'Live location is only available after approval and while you are accepting new work.' : 'Location controls will appear once your current work status is confirmed.'}</Text></View></View>
      {available === false ? <Pressable accessibilityRole="button" onPress={onManageAvailability} style={styles.action}><Text style={styles.actionText}>Manage availability</Text></Pressable> : null}
    </View>;
  }

  return <View style={styles.card}>
    <View style={styles.heading}><WorkVisual kind="location" size={42} /><View style={styles.flex}><Text style={styles.title}>{(Platform.OS !== 'android' && Platform.OS !== 'ios') ? 'Nearby sharing unavailable' : query.data?.running ? available === false ? 'Sharing for your active visit' : 'Location sharing is on' : 'Location sharing is off'}</Text><Text style={styles.copy}>{(Platform.OS !== 'android' && Platform.OS !== 'ios') ? 'Live work location is currently supported on Android and iOS.' : query.data?.running ? available === false ? 'New work is paused, but your current customer can still follow the active journey. Sharing stops when you arrive.' : 'Your assigned customer can see your location while you travel.' : 'Turn it on to receive nearby service work.'}</Text></View></View>
    {(Platform.OS === 'android' || Platform.OS === 'ios') ? <Pressable accessibilityRole="button" accessibilityState={{busy, disabled: busy || query.isPending || (!query.data?.running && available !== true)}} disabled={busy || query.isPending || (!query.data?.running && available !== true)} onPress={toggle} style={styles.action}><Text style={styles.actionText}>{busy ? 'Updating location…' : query.data?.running ? 'Stop sharing' : 'Go online for nearby work'}</Text></Pressable> : null}
    {(Platform.OS === 'android' || Platform.OS === 'ios') && query.data?.running ? <Text style={styles.privacy}>Sharing can continue in the background. Stop it here or from the system location indicator.</Text> : null}
    {error || query.data?.error ? <Text accessibilityRole="alert" style={styles.error}>{error || query.data?.error}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: {padding: 16, marginTop: 20, gap: 10, backgroundColor: ProColors.surface, borderRadius: 16, borderWidth: 1, borderColor: ProColors.border},
  heading: {flexDirection: 'row', alignItems: 'center', gap: 12},
  flex: {flex: 1},
  title: {...ProType.card, color: ProColors.text},
  copy: {...ProType.meta, color: ProColors.secondary, marginTop: 2},
  action: {minHeight: 44, borderRadius: 12, backgroundColor: ProColors.accent, alignItems: 'center', justifyContent: 'center'},
  actionText: {...ProType.action, color: ProColors.primary},
  privacy: {...ProType.meta, color: ProColors.secondary},
  error: {color: Colors.error},
});
