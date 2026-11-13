import React, {useEffect, useState} from 'react';
import {Image, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useNavigation} from '@react-navigation/native';
import {useQuery} from '@tanstack/react-query';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {ScreenHeader} from '../components/ScreenHeader';
import {ScreenLoading} from '../components/ScreenLoading';
import {EmptyState} from '../components/EmptyState';
import {api} from '../services/apiClient';
import {useProToast} from '../stores/proToast';
import {ProColors, ProRadius, ProSpacing, ProType} from '../theme/professionalTheme';

export type ReviewQrView = {url: string; code: string; qrPng: string; fullName: string;
  averageRating: number; totalReviewsCount: number};

const QR_CACHE_KEY = 'pro-review-qr.cache.v1';
export type CachedReviewQr = {view: ReviewQrView; savedAt: string};

export function MyQrScreen({load = () => api.get<ReviewQrView>('/professionals/me/review-qr')}: {
  load?: () => Promise<ReviewQrView>;
}) {
  const navigation = useNavigation();
  const toast = useProToast();
  const query = useQuery({queryKey: ['pro-review-qr'], queryFn: load, retry: 1, staleTime: 5 * 60_000});
  // The QR/code pair never changes for a pro, so a cached copy shown at a
  // customer's home with no signal is still a working QR — just stale stars.
  const [cached, setCached] = useState<CachedReviewQr | null>(null);
  useEffect(() => {
    AsyncStorage.getItem(QR_CACHE_KEY)
      .then(raw => { if (raw) setCached(JSON.parse(raw) as CachedReviewQr); })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!query.data) return;
    const entry: CachedReviewQr = {view: query.data, savedAt: new Date().toISOString()};
    setCached(entry);
    AsyncStorage.setItem(QR_CACHE_KEY, JSON.stringify(entry)).catch(() => undefined);
  }, [query.data]);
  const view = query.data ?? cached?.view;
  const showingCached = !query.data && !!cached;
  const cachedLabel = cached ? new Date(cached.savedAt).toLocaleDateString('en-IN', {day: 'numeric', month: 'short'}) : '';

  const share = () => {
    if (!view) return;
    Share.share({message: `Rate my work on NAHTREEK: ${view.url} (code ${view.code})`})
      .catch(() => toast('Could not open sharing.', 'error'));
  };

  return <View style={styles.root}>
    <ScreenHeader title="My ratings QR" subtitle="Clients scan to reach your reviews" onBack={() => navigation.goBack()} />
    {query.isPending && !cached ? <ScreenLoading label="Preparing your QR…" /> : query.isError || !view ? (
      <EmptyState title="Could not load your QR" message="Check your connection and try again." actionLabel={query.isFetching ? 'Checking…' : 'Try again'} onAction={() => void query.refetch()} />
    ) : (
      <ScrollView contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => void query.refetch()}
            tintColor={ProColors.primary}
            colors={[ProColors.primary]}
          />
        }>
        {showingCached ? (
          <View style={styles.staleBanner}>
            <MaterialCommunityIcons name="cloud-off-outline" size={16} color={ProColors.warning} />
            <Text style={styles.staleText}>Offline — showing your saved QR from {cachedLabel}. The code still works; the rating may be older.</Text>
          </View>
        ) : null}
        <View style={styles.card}>
          <Text style={styles.name}>{view.fullName}</Text>
          <Text style={styles.rating}>
            {view.totalReviewsCount > 0
              ? `★ ${view.averageRating.toFixed(1)} · ${view.totalReviewsCount} review${view.totalReviewsCount === 1 ? '' : 's'}`
              : 'No reviews yet — your first scan starts here'}
          </Text>
          <Image accessibilityRole="image" accessibilityLabel={`Ratings QR code ${view.code}`}
            source={{uri: view.qrPng}} style={styles.qr} resizeMode="contain" />
          <Text style={styles.codeLabel}>Manual code (under the QR)</Text>
          <Text selectable style={styles.code}>{view.code}</Text>
          <Text style={styles.hint}>Show this after finishing a job. The client scans it with their camera and lands straight on your ratings page. If their camera cannot scan, they can type the code in the Home app instead.</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={share} style={styles.share}>
          <MaterialCommunityIcons name="share-variant-outline" size={20} color={ProColors.onAccent} />
          <Text style={styles.shareText}>Share my ratings link</Text>
        </Pressable>
      </ScrollView>
    )}
  </View>;
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: ProColors.background},
  body: {padding: ProSpacing.md, gap: ProSpacing.md},
  staleBanner: {flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: ProColors.surface,
    borderRadius: ProRadius.card, padding: ProSpacing.sm, borderWidth: 1, borderColor: ProColors.border},
  staleText: {...ProType.meta, color: ProColors.secondary, flex: 1},
  card: {backgroundColor: ProColors.surface, borderRadius: ProRadius.card, padding: ProSpacing.lg, gap: 8, alignItems: 'center'},
  name: {fontSize: 20, fontWeight: '800', color: ProColors.text, textAlign: 'center'},
  rating: {...ProType.meta, color: ProColors.secondary},
  qr: {width: 240, height: 240, marginVertical: ProSpacing.sm},
  codeLabel: {...ProType.meta, color: ProColors.secondary},
  code: {fontSize: 28, fontWeight: '800', letterSpacing: 6, color: ProColors.text},
  hint: {...ProType.body, color: ProColors.secondary, textAlign: 'center'},
  share: {backgroundColor: ProColors.accent, borderRadius: ProRadius.input, minHeight: 52,
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center'},
  shareText: {fontSize: 16, fontWeight: '800', color: ProColors.onAccent},
});
