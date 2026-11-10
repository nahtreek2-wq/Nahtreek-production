import React, {useState} from 'react';
import {Pressable, TouchableOpacity, View, Text, ScrollView, StyleSheet} from 'react-native';
import {useNavigation, useRoute, RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useQuery} from '@tanstack/react-query';
import {Colors, Typography, Spacing} from '@nahtreek/design-system';
import {AppHeader, Avatar, BottomSheet, Button, Card, Icon, ICONS, MemberBadge, RatingStars, SectionHeader, VerifiedBadge} from '../components/ui';
import {ServiceBookingForm} from '../components/ServiceBookingForm';
import {EngineerCardSkeleton} from '../components/SkeletonLoader';
import {ErrorState} from '../components/ui';
import {api} from '../services/apiClient';
import {useFavoritesList, useToggleFavorite} from '../services/queries';
import {useServiceCategories, type ServiceCategory} from '../services/platformQueries';
import {useSessionStore} from '../stores/session';
import {useToast} from '../stores/toast';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type ProfileRoute = RouteProp<RootStackParamList, 'ProviderProfile'>;

export type ProviderReviewDto = {id: string; rating: number; comment: string; createdAt: string; clientName: string};
export type ProviderDetailDto = {id: string; fullName: string; avatarUrl: string | null; title: string;
  bio: string | null; baseCity: string; baseState: string; yearsOfExperience: number; serviceCategories: string[];
  averageRating: number; totalReviewsCount: number; verificationStatus: string; isMember?: boolean; reviews: ProviderReviewDto[]};

export function ProviderProfileScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<ProfileRoute>();
  const insets = useSafeAreaInsets();
  const {professionalProfileId} = route.params;
  const detail = useQuery({queryKey: ['provider-profile', professionalProfileId],
    queryFn: () => api.get<ProviderDetailDto>(`/discovery/providers/${professionalProfileId}`), retry: 1});
  const pro = detail.data;
  const toast = useToast();
  const token = useSessionStore(state => state.accessToken);
  const favoritesQ = useFavoritesList();
  const toggleFavorite = useToggleFavorite();
  const fav = (favoritesQ.data ?? []).some(f => f.professionalId === professionalProfileId);
  const onHeart = () => {
    if (!token) { navigation.navigate('Login'); return; }
    if (toggleFavorite.isPending) return;
    toggleFavorite.mutate({professionalId: professionalProfileId, isAdding: !fav}, {
      onSuccess: () => toast(!fav ? 'Saved to your list' : 'Removed from saved', 'success'),
      onError: () => toast('Could not update saved professionals. Please try again.', 'error'),
    });
  };
  // Booking needs a service id: match the provider's offered categories to
  // the live catalogue. No match (stale catalogue) falls back to browsing.
  const categories = useServiceCategories();
  const [sheet, setSheet] = useState(false);
  const [service, setService] = useState<ServiceCategory | null>(null);
  const offered = (categories.data ?? []).filter(item =>
    (pro?.serviceCategories ?? []).some(key =>
      key === item.id || key === item.slug || key.toLowerCase() === item.title.toLowerCase()));
  const requestService = () => {
    if (!token) { navigation.navigate('Login'); return; }
    if (!offered.length) { navigation.navigate('Services', {}); return; }
    setService(offered.length === 1 ? offered[0] : null);
    setSheet(true);
  };

  return <View style={[styles.root, {paddingBottom: insets.bottom}]}>
    <AppHeader title="Professional profile" subtitle={pro ? `${pro.fullName} · ${pro.title}` : undefined} onBack={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('MainTabs')}
      right={
        <TouchableOpacity onPress={onHeart} accessibilityRole="button"
          accessibilityLabel={fav ? 'Remove from saved' : 'Save professional'} style={styles.heart}>
          <Icon name={fav ? ICONS.heart : ICONS.heartOutline} size={20} color={Colors.white} />
        </TouchableOpacity>
      } />
    {detail.isPending ? <EngineerCardSkeleton /> : detail.isError || !pro ? (
      <ErrorState title="Could not load this professional" message="Check your connection and try again."
        actionLabel={detail.isFetching ? 'Checking…' : 'Try again'} onAction={() => void detail.refetch()} />
    ) : (
      <ScrollView contentContainerStyle={styles.body}>
        <Card>
          <View style={styles.head}>
            <Avatar uri={pro.avatarUrl ?? undefined} name={pro.fullName} size={64} />
            <View style={styles.headCopy}>
              <View style={styles.nameRow}>
                <Text style={styles.name}>{pro.fullName}</Text>
                {pro.verificationStatus === 'VERIFIED' ? <VerifiedBadge /> : null}
                {pro.isMember ? <MemberBadge /> : null}
              </View>
              {!!pro.title && <Text style={styles.title}>{pro.title}</Text>}
              <View style={styles.metaRow}>
                <Icon name={ICONS.location} size={12} color={Colors.slate500} />
                <Text style={styles.meta}>{[pro.baseCity, pro.baseState].filter(Boolean).join(', ') || 'India'}</Text>
              </View>
            </View>
          </View>
          <View style={styles.ratingRow}>
            <RatingStars rating={pro.averageRating} />
            <Text style={styles.meta}>{pro.totalReviewsCount > 0
              ? `${pro.averageRating.toFixed(1)} · ${pro.totalReviewsCount} review${pro.totalReviewsCount === 1 ? '' : 's'}`
              : 'No reviews yet'}</Text>
          </View>
          {!!pro.bio && <Text style={styles.bio}>{pro.bio}</Text>}
        </Card>
        <SectionHeader title={`Reviews (${pro.reviews.length})`} />
        {pro.reviews.length === 0 ? (
          <Card><Text style={styles.meta}>No written reviews yet. Be the first after your completed booking.</Text></Card>
        ) : pro.reviews.map(review => (
          <Card key={review.id}>
            <View style={styles.reviewHead}>
              <Text style={styles.reviewer}>{review.clientName}</Text>
              <Text style={styles.meta}>{new Date(review.createdAt).toLocaleDateString('en-IN', {day: 'numeric', month: 'short', year: 'numeric'})}</Text>
            </View>
            <RatingStars rating={review.rating} />
            <Text style={styles.bio}>{review.comment}</Text>
          </Card>
        ))}
        <Text style={styles.hint}>Reviews come only from completed NAHTREEK bookings, so every rating here is from a real customer.</Text>
        {pro.serviceCategories.length > 0 ? (
          <View style={styles.servicesCard}>
            <Text style={styles.servicesTitle}>Services offered</Text>
            {pro.serviceCategories.map(key => (
              <Text key={key} style={styles.meta}>• {(categories.data ?? []).find(item => item.id === key || item.slug === key)?.title ?? key}</Text>
            ))}
          </View>
        ) : null}
        <Button label="Request this professional" onPress={requestService} />
      </ScrollView>
    )}
    <BottomSheet visible={sheet} onClose={() => { setSheet(false); setService(null); }}
      title={service ? 'Tell us about the work' : 'Choose a service'} subtitle={pro ? `Requesting ${pro.fullName}` : undefined}>
      {service && pro ? (
        <ServiceBookingForm serviceId={service.id} preferred={{id: pro.id, fullName: pro.fullName}}
          onBooked={id => { setSheet(false); setService(null); navigation.navigate('ServiceRequestDetail', {requestId: id, submitted: true}); }} />
      ) : offered.map(item => (
        <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Request ${item.title}`}
          onPress={() => setService(item)} style={styles.serviceRow}>
          <Text style={styles.serviceTitle}>{item.title}</Text>
          <Icon name={ICONS.chevronRight} size={20} color={Colors.navyMid} />
        </Pressable>
      ))}
    </BottomSheet>
  </View>;
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: Colors.offWhite},
  body: {padding: 20, gap: Spacing.md},
  heart: {padding: 8},
  servicesCard: {gap: 4, backgroundColor: Colors.white, borderRadius: 14, padding: Spacing.lg},
  servicesTitle: {fontSize: 15, fontWeight: '700', color: Colors.navyDeep, marginBottom: 2},
  serviceRow: {minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10},
  serviceTitle: {flex: 1, fontSize: 16, fontWeight: '600', color: Colors.navyDeep},
  head: {flexDirection: 'row', gap: Spacing.md, alignItems: 'center'},
  headCopy: {flex: 1, gap: 2},
  nameRow: {flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexWrap: 'wrap'},
  name: {fontSize: 20, fontWeight: '800', color: Colors.navyDeep},
  title: {...Typography.body, color: Colors.slate600},
  metaRow: {flexDirection: 'row', alignItems: 'center', gap: 4},
  meta: {...Typography.caption, color: Colors.slate500},
  ratingRow: {flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm},
  bio: {...Typography.body, color: Colors.slate800, marginTop: Spacing.xs},
  reviewHead: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  reviewer: {fontSize: 15, fontWeight: '700', color: Colors.navyDeep},
  hint: {...Typography.caption, color: Colors.slate500, textAlign: 'center', paddingBottom: Spacing.lg},
});
