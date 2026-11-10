import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import {Colors, Spacing, Typography, BorderRadius} from '@nahtreek/design-system';
import {ApiError} from '../../services/apiClient';

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    return NetInfo.addEventListener(state => {
      setOnline(state.isConnected !== false && state.isInternetReachable !== false);
    });
  }, []);
  return online;
}

interface OfflineBannerProps {
  force?: boolean;
  onRetry?: () => void;
  retrying?: boolean;
  title?: string;
  message?: string;
  error?: unknown;
  hasContent?: boolean;
  topEdge?: boolean;
}

export function OfflineBanner({force = false, onRetry, retrying = false, title, message, error, hasContent = false, topEdge = false}: OfflineBannerProps) {
  const online = useOnline();
  const insets = useSafeAreaInsets();
  if (online && !force) return null;
  const connectionIssue = error instanceof ApiError && (error.status === 0 || error.status >= 500);
  const defaultTitle = !online ? 'No internet connection' : connectionIssue ? 'Service is unavailable' : 'Could not update';
  const defaultMessage = !online
    ? 'Connect to the internet, then try again.'
    : connectionIssue
    ? 'We cannot reach Nahtreek right now. Please try again shortly.'
    : 'Your latest information could not be loaded.';

  // The global banner mounts above the navigator, so it must clear the
  // notch/status bar itself instead of overlapping it. Mid-screen banners
  // already sit below their header and must not gain the inset.
  const body = (
      <View style={styles.container}>
      <View style={styles.copy}>
        <Text style={styles.title}>{title ?? defaultTitle}</Text>
        <Text style={styles.message}>
          {message ?? (hasContent ? 'Showing the last available results. ' : '') + defaultMessage}
        </Text>
      </View>
      {onRetry ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Retry loading this screen"
          disabled={retrying}
          onPress={onRetry}
          style={[styles.retry, retrying && styles.retryDisabled]}>
          <Text style={styles.retryLabel}>{retrying ? 'Checking…' : 'Try again'}</Text>
        </TouchableOpacity>
      ) : null}
      </View>
  );
  if (!topEdge) return <View accessibilityRole="alert">{body}</View>;
  return (
    <View accessibilityRole="alert" style={[styles.safeTop, {paddingTop: insets.top}]}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  safeTop: {backgroundColor: Colors.navyDeep},
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.slate200,
    borderRadius: BorderRadius.md,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  copy: {
    flex: 1,
  },
  title: {
    ...Typography.badge,
    color: Colors.navyDeep,
  },
  message: {
    ...Typography.caption,
    color: Colors.slate500,
    marginTop: 1,
  },
  retry: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.infoBg,
  },
  retryDisabled: {
    opacity: 0.55,
  },
  retryLabel: {
    ...Typography.badge,
    color: Colors.navyDeep,
  },
});
