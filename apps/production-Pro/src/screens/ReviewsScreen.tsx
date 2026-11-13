import React from 'react';
import {Animated, RefreshControl, StyleSheet, Text, View} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {useNavigation} from '@react-navigation/native';
import {useQuery} from '@tanstack/react-query';
import {BorderRadius, Colors, Spacing, Typography} from '@nahtreek/design-system';
import {ScreenHeader} from '../components/ScreenHeader';
import {stagger} from '../../../../packages/mobile-ui/motion';
import {ProButton} from '../components/ProButton';
import {ScreenLoading} from '../components/ScreenLoading';
import {EmptyState} from '../components/EmptyState';
import {MotionReveal} from '../components/MotionReveal';
import {ScrollMotionBar, useScrollMotion} from '../components/ScrollMotionBar';
import {api} from '../services/apiClient';

type Review = {
  id: string;
  rating: number;
  comment: string;
  createdAt: string;
  client: {fullName: string};
  engineerRequest?: {projectTitle: string} | null;
  serviceRequest?: {category: {title: string}} | null;
};
type ProfileResponse = {
  profile: null | {
    averageRating: number;
    totalReviewsCount: number;
    completedJobs: number;
    reviewsReceived: Review[];
  };
};

export function ReviewsScreen() {
  const scrollMotion = useScrollMotion();
  const navigation = useNavigation();
  const query = useQuery({
    queryKey: ['professional-profile'],
    queryFn: () => api.get<ProfileResponse>('/professionals/me'),
    retry: 1,
  });
  const profile = query.data?.profile;
  const averageRating = profile?.averageRating ?? 0;
  const reviews = profile?.reviewsReceived ?? [];
  const counts = [5, 4, 3, 2, 1].map(value => ({
    value,
    count: reviews.filter(review => review.rating === value).length,
  }));
  const maxCount = Math.max(1, ...counts.map(item => item.count));

  return (
    <View style={styles.root}>
      <ScreenHeader title="Reviews & reputation" subtitle="Client feedback on your work" onBack={() => navigation.goBack()} />
      <ScrollMotionBar offset={scrollMotion.offset} reducedMotion={scrollMotion.reducedMotion} />
      {query.isPending ? <ScreenLoading label="Loading your reviews…" /> : null}
      {query.isError ? (
        <View style={styles.errorWrap}>
          <EmptyState icon="cloud-off-outline" title="Reviews could not load" message="Check your connection and try again." />
          <ProButton label="Try again" variant="secondary" onPress={() => void query.refetch()} />
        </View>
      ) : null}
      {query.isSuccess ? (
        <Animated.ScrollView onScroll={scrollMotion.onScroll} scrollEventThrottle={16} contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={() => void query.refetch()}
              tintColor={Colors.navyDeep}
              colors={[Colors.navyDeep]}
            />
          }>
          <MotionReveal>
            <View style={styles.summary}>
              <View style={styles.scoreBlock}>
                <Text style={styles.score}>{profile?.totalReviewsCount ? profile.averageRating.toFixed(1) : '—'}</Text>
                <View style={styles.stars} accessibilityLabel={`${profile?.totalReviewsCount ? profile.averageRating.toFixed(1) : 'No'} out of 5 stars`}>
                  {[1, 2, 3, 4, 5].map(star => (
                    <MaterialCommunityIcons key={star} name={averageRating >= star ? 'star' : 'star-outline'} size={18} color={Colors.navyDeep} />
                  ))}
                </View>
                <Text style={styles.scoreCaption}>{profile?.totalReviewsCount ?? 0} client reviews</Text>
              </View>
              <View style={styles.distribution}>
                <Text style={styles.distributionCaption}>Recent rating mix</Text>
                {counts.map(item => (
                  <View key={item.value} style={styles.distributionRow}>
                    <Text style={styles.distributionLabel}>{item.value}</Text>
                    <MaterialCommunityIcons name="star" size={13} color={Colors.navyDeep} />
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, {width: `${(item.count / maxCount) * 100}%`}]} />
                    </View>
                    <Text style={styles.distributionCount}>{item.count}</Text>
                  </View>
                ))}
              </View>
            </View>
          </MotionReveal>
          <View style={styles.workNote}>
            <MaterialCommunityIcons name="briefcase-check-outline" size={20} color={Colors.navyDeep} />
            <Text style={styles.workNoteText}>{profile?.completedJobs ?? 0} completed jobs</Text>
          </View>
          <Text style={styles.sectionTitle}>Recent feedback</Text>
          {reviews.length ? reviews.map((review, index) => (
            <MotionReveal key={review.id} delay={stagger(index)}>
              <View style={styles.reviewCard}>
                <View style={styles.reviewTop}>
                  <View style={styles.reviewAvatar}>
                    <Text style={styles.reviewInitial}>{(review.client.fullName || 'C').trim().charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={styles.reviewIdentity}>
                    <Text style={styles.clientName}>{review.client.fullName || 'Client'}</Text>
                    <Text style={styles.reviewDate}>{new Date(review.createdAt).toLocaleDateString('en-IN', {day: 'numeric', month: 'short', year: 'numeric'})}</Text>
                  </View>
                  <View style={styles.ratingPill}>
                    <MaterialCommunityIcons name="star" size={15} color={Colors.navyDeep} />
                    <Text style={styles.ratingValue}>{review.rating}.0</Text>
                  </View>
                </View>
                <Text style={styles.projectTitle}>{review.engineerRequest?.projectTitle ?? review.serviceRequest?.category.title ?? 'Completed work'}</Text>
                <Text style={styles.comment}>{review.comment}</Text>
              </View>
            </MotionReveal>
          )) : (
            <EmptyState icon="star-outline" title="Your first review is on its way" message="After a client completes and rates a job, their feedback and your updated rating will appear here. Ask happy clients to scan your QR after a job." actionLabel="Show my QR" onAction={() => (navigation as {navigate: (route: string) => void}).navigate('MyQr')} />
          )}
          <Text style={styles.privacyNote}>Only ratings from completed work are included. Client contact details are never shown here.</Text>
        </Animated.ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: Colors.offWhite},
  content: {padding: Spacing.md, paddingBottom: Spacing.xxl, gap: Spacing.md},
  summary: {padding: Spacing.md, backgroundColor: Colors.white, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.slate200, flexDirection: 'row', gap: Spacing.md},
  scoreBlock: {width: 116, alignItems: 'center', justifyContent: 'center', gap: 5},
  score: {fontSize: 38, lineHeight: 44, fontWeight: '800', color: Colors.navyDeep},
  stars: {flexDirection: 'row'},
  scoreCaption: {...Typography.caption, color: Colors.slate600, textAlign: 'center'},
  distribution: {flex: 1, justifyContent: 'center', gap: 7},
  distributionCaption: {fontSize: 11, fontWeight: '700', color: Colors.slate500, marginBottom: 2},
  distributionRow: {flexDirection: 'row', alignItems: 'center', gap: 3},
  distributionLabel: {width: 12, color: Colors.slate700, fontSize: 12, textAlign: 'right'},
  barTrack: {height: 7, flex: 1, borderRadius: 4, backgroundColor: Colors.slate100, overflow: 'hidden', marginHorizontal: 4},
  barFill: {height: '100%', borderRadius: 4, backgroundColor: Colors.navyDeep},
  distributionCount: {width: 20, color: Colors.slate500, fontSize: 11, textAlign: 'right'},
  workNote: {minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, borderRadius: 14, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.slate200},
  workNoteText: {fontSize: 14, fontWeight: '700', color: Colors.navyDeep},
  sectionTitle: {...Typography.h3, color: Colors.navyDeep, marginTop: 4},
  reviewCard: {padding: 16, gap: 10, backgroundColor: Colors.white, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.slate200},
  reviewTop: {flexDirection: 'row', alignItems: 'center', gap: 10},
  reviewAvatar: {width: 42, height: 42, borderRadius: 21, backgroundColor: Colors.navyMid, alignItems: 'center', justifyContent: 'center'},
  reviewInitial: {fontSize: 17, fontWeight: '700', color: Colors.white},
  reviewIdentity: {flex: 1},
  clientName: {fontSize: 15, fontWeight: '700', color: Colors.navyDeep},
  reviewDate: {fontSize: 12, color: Colors.slate500, marginTop: 2},
  ratingPill: {flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 9, paddingVertical: 5},
  ratingValue: {fontSize: 13, fontWeight: '700', color: Colors.navyDeep},
  projectTitle: {fontSize: 13, fontWeight: '600', color: Colors.navyMid},
  comment: {fontSize: 15, lineHeight: 22, color: Colors.slate800},
  privacyNote: {fontSize: 12, lineHeight: 18, textAlign: 'center', color: Colors.slate500, marginTop: 4},
  errorWrap: {flex: 1, justifyContent: 'center', padding: Spacing.md, gap: 12},
});
