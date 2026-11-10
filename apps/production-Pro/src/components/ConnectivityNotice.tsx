import React, {useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import {Colors, Spacing, Typography} from '@nahtreek/design-system';

export function ConnectivityNotice() {
  const [online, setOnline] = useState(true);
  const [restored, setRestored] = useState(false);
  const previous = useRef<boolean | undefined>();
  const insets = useSafeAreaInsets();

  useEffect(() => NetInfo.addEventListener(state => {
    const next = state.isConnected !== false && state.isInternetReachable !== false;
    if (previous.current === false && next) {
      setRestored(true);
      setTimeout(() => setRestored(false), 3_000);
    }
    previous.current = next;
    setOnline(next);
  }), []);

  if (online && !restored) return null;
  const offline = !online;
  // Mounted above the navigator: clear the notch/status bar instead of
  // overlapping it, extending the banner's own background upward.
  return <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.banner, offline ? styles.offline : styles.online, {paddingTop: insets.top + Spacing.sm}]}>
    <View style={styles.copy}>
      <Text style={[styles.title, offline ? styles.offlineText : styles.onlineText]}>{offline ? 'You are offline' : 'Back online'}</Text>
      <Text style={styles.message}>{offline ? 'Your details stay on this screen. Reconnect before submitting or refreshing.' : 'You can continue where you left off.'}</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  banner: {paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderBottomWidth: 1},
  offline: {backgroundColor: Colors.warningBg, borderBottomColor: Colors.warning + '40'},
  online: {backgroundColor: Colors.successBg, borderBottomColor: Colors.success + '35'},
  copy: {gap: 2},
  title: {...Typography.badge},
  offlineText: {color: Colors.warning},
  onlineText: {color: Colors.success},
  message: {...Typography.caption, color: Colors.slate600},
});
