import React, {useState} from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  StyleSheet,
  Image,
  type ImageSourcePropType,
} from 'react-native';
import {useNavigation, useRoute, RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {
  Colors,
  Typography,
  Spacing,
  BorderRadius,
} from '@nahtreek/design-system';
import {inr} from '../utils/format';
import {
  AppHeader,
  Avatar,
  Button,
  Card,
  Icon,
  ICONS,
  MemberBadge,
  RatingStars,
  RemoteImg,
  SectionHeader,
  VerifiedBadge,
} from '../components/ui';
import {headerStyles} from '../../../../packages/mobile-ui/headerStyles';
import {ConsultationSheet} from '../components/ConsultationSheet';
import {GalleryViewer} from '../components/GalleryViewer';
import {planSheetPrefill, usePlanDraft, usePlanQuoteRequest} from '../services/planQuotes';
import {
  useCreateRequest,
  useEngineerDetail,
  useFavoritesList,
  useToggleFavorite,
} from '../services/queries';
import {useToast} from '../stores/toast';
import {EngineerCardSkeleton} from '../components/SkeletonLoader';
import {ErrorState, OfflineBanner} from '../components/ui';
import {
  HERO_PHOTOS,
  portraitFor,
  professionalSceneFor,
  workPhotoFor,
} from '../assets/imagery';
import type {RootStackParamList} from '../navigation/types';
import {useSessionStore} from '../stores/session';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type ProfileRoute = RouteProp<RootStackParamList, 'EngineerProfile'>;

export function EngineerProfileScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<ProfileRoute>();
  const insets = useSafeAreaInsets();
  const {
    data: engineer,
    isLoading,
    isOffline,
    isRefetching,
    refetch,
  } = useEngineerDetail(route.params.engineerId);
  const [sheet, setSheet] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
  const planId = route.params.planId;
  const planDraft = usePlanDraft(planId);
  const requestPlanQuotes = usePlanQuoteRequest();
  const favoritesQ = useFavoritesList();
  const toggleFavorite = useToggleFavorite();
  const createRequest = useCreateRequest();
  const toast = useToast();
  const token = useSessionStore(state => state.accessToken);
  const fav = ((favoritesQ.data ?? []) as {professionalId: string}[]).some(
    f => f.professionalId === engineer?.professionalProfileId,
  );
  const workImages = (engineer?.portfolio ?? [])
    .filter(p => p.imageUrl)
    .map(p => p.imageUrl as string);
  const onHeart = () => {
    if (!token) {
      navigation.navigate('Login');
      return;
    }
    if (toggleFavorite.isPending) return;
    if (!engineer) return;
    toggleFavorite.mutate(
      {professionalId: engineer.professionalProfileId, isAdding: !fav},
      {
        onSuccess: () =>
          toast(!fav ? 'Saved to your list' : 'Removed from saved', 'success'),
        onError: () =>
          toast(
            'Could not update saved professionals. Please try again.',
            'error',
          ),
      },
    );
  };

  const track = (requestId: string) => {
    setSheet(false);
    navigation.navigate('RequestDetail', {requestId});
  };

  if (isLoading && !engineer) {
    return (
      <View style={styles.container}>
        <AppHeader title="Loading profile" onBack={() => navigation.goBack()} />
        <View style={styles.body}>
          <EngineerCardSkeleton />
        </View>
      </View>
    );
  }
  if (!engineer) {
    return (
      <View style={styles.container}>
        <AppHeader
          title="Profile unavailable"
          onBack={() => navigation.goBack()}
        />
        <ErrorState
          icon={ICONS.engineers}
          title="Couldn't load this profile"
          message="Check your connection and try again."
          actionLabel="Retry"
          onAction={refetch}
        />
      </View>
    );
  }

  const portfolio = engineer.portfolio ?? [];
  const serviceAreas = engineer.serviceAreas ?? [];
  const galleryItems: {key: string; source: ImageSourcePropType}[] =
    workImages.length > 0
      ? workImages.map(url => ({key: url, source: {uri: url}}))
      : [
          {key: 'planning', source: HERO_PHOTOS.planning},
          {key: 'renovation', source: workPhotoFor('renovation')},
          {key: 'inspection', source: workPhotoFor('inspection')},
        ];
  const reviews = engineer.reviews ?? [];
  const consultationFeeLabel =
    engineer.consultationFeePaisa === undefined
      ? 'Request consultation'
      : `Request consultation • ${inr(engineer.consultationFeePaisa)}`;

  return (
    <View style={styles.container}>
      <AppHeader
        title="Engineer profile"
        subtitle={`${engineer.fullName} · ${engineer.title}`}
        onBack={() => navigation.goBack()}
        right={
          <TouchableOpacity
            style={headerStyles.navigation}
            onPress={onHeart}
            accessibilityLabel={
              fav ? 'Remove from saved' : 'Save professional'
            }>
            <Icon
              name={fav ? ICONS.heart : ICONS.heartOutline}
              size={18}
              color={Colors.white}
            />
          </TouchableOpacity>
        }
      />

      <OfflineBanner force={isOffline} onRetry={refetch} />
      <ScrollView
        contentContainerStyle={[
          styles.body,
          {paddingBottom: insets.bottom + 90},
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={Colors.navyDeep}
            colors={[Colors.navyDeep]}
          />
        }>
        <View style={styles.cover}>
          <RemoteImg
            uri={engineer.coverUrl}
            fallback={professionalSceneFor(engineer.id)}
            style={styles.coverImage}
          />
        </View>
        <Avatar
          name={engineer.fullName}
          size={64}
          uri={engineer.avatarUrl}
          source={engineer.avatarUrl ? undefined : portraitFor(engineer.id)}
          style={styles.avatarOverlap}
        />
        <View style={styles.summary}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{engineer.fullName}</Text>
            {engineer.verificationStatus === 'VERIFIED' && <VerifiedBadge />}
            {engineer.isMember ? <MemberBadge /> : null}
          </View>
          <RatingStars
            rating={engineer.averageRating}
            count={engineer.totalReviewsCount}
          />
          <View style={styles.metaRow}>
            <Text style={styles.meta}>{engineer.yearsOfExperience} yrs</Text>
            <Text style={styles.dot}>•</Text>
            <Icon name={ICONS.location} size={12} color={Colors.slate500} />
            <Text style={styles.meta}>
              {engineer.distanceKm === undefined
                ? 'Distance unavailable'
                : `${engineer.distanceKm} km`}{' '}
              • {engineer.baseCity}
            </Text>
          </View>
          <View style={styles.slotChip}>
            <Icon name={ICONS.clock} size={13} color={engineer.isAvailable && engineer.nextSlot ? Colors.success : Colors.slate500} />
            <Text style={styles.slotLabel}>{!engineer.isAvailable ? 'Currently unavailable' : engineer.nextSlot ? `Next slot: ${engineer.nextSlot}` : 'Availability not added'}</Text>
          </View>
        </View>

        <SectionHeader title="About" />
        <Text style={styles.about}>{engineer.bio}</Text>

        <SectionHeader title="Credentials" />
        <Card style={styles.block}>
          <View style={styles.credRow}>
            <Icon name={ICONS.requests} size={16} color={Colors.navyDeep} />
            <View style={styles.rowInfo}>
              <Text style={styles.credTitle}>
                {engineer.qualificationDegree}
              </Text>
              <Text style={styles.credSub}>
                {engineer.institution} • {engineer.graduationYear}
              </Text>
            </View>
          </View>
          <View style={styles.credRow}>
            <Icon name={ICONS.verified} size={16} color={Colors.verifiedBlue} />
            <View style={styles.rowInfo}>
              <Text style={styles.credTitle}>
                License {engineer.licenseNumber}
              </Text>
              <Text style={styles.credSub}>
                Identity + degree documents verified
              </Text>
            </View>
          </View>
        </Card>

        <SectionHeader title="Recent Work" />
        {portfolio.map(item => (
          <Card key={item.title} style={styles.block}>
            <View style={styles.credRow}>
              {item.imageUrl ? (
                <RemoteImg
                  uri={item.imageUrl}
                  fallback={professionalSceneFor(item.title)}
                  style={styles.workThumb}
                />
              ) : (
                <Icon name={ICONS.building} size={16} color={Colors.navyDeep} />
              )}
              <View style={styles.rowInfo}>
                <Text style={styles.credTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={styles.credSub} numberOfLines={1}>
                  {item.meta}
                </Text>
              </View>
            </View>
          </Card>
        ))}

        <SectionHeader title="Service Areas" />
        <View style={styles.chipWrap}>
          {serviceAreas.map(area => (
            <View key={area} style={styles.areaChip}>
              <Text style={styles.areaLabel}>{area}</Text>
            </View>
          ))}
        </View>

        <SectionHeader
          title="Gallery"
          actionLabel="View all"
          onAction={() => setGalleryIndex(0)}
        />
        <View style={styles.galleryRow}>
          {workImages.length ? (
            workImages
              .slice(0, 3)
              .map((url, index) => (
                <TouchableOpacity
                  key={url}
                  style={styles.galleryThumbWrap}
                  accessibilityRole="button"
                  accessibilityLabel={`Open work photo ${index + 1}`}
                  onPress={() => setGalleryIndex(index)}>
                  <RemoteImg
                    uri={url}
                    fallback={professionalSceneFor(url)}
                    style={styles.galleryThumb}
                  />
                </TouchableOpacity>
              ))
          ) : (
            <>
              <TouchableOpacity
                style={styles.galleryThumbWrap}
                accessibilityRole="button"
                accessibilityLabel="Open work photo 1"
                onPress={() => setGalleryIndex(0)}>
                <Image
                  source={HERO_PHOTOS.planning}
                  style={styles.galleryThumb}
                  resizeMode="cover"
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.galleryThumbWrap}
                accessibilityRole="button"
                accessibilityLabel="Open work photo 2"
                onPress={() => setGalleryIndex(1)}>
                <Image
                  source={workPhotoFor('renovation')}
                  style={styles.galleryThumb}
                  resizeMode="cover"
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.galleryThumbWrap}
                accessibilityRole="button"
                accessibilityLabel="Open work photo 3"
                onPress={() => setGalleryIndex(2)}>
                <Image
                  source={workPhotoFor('inspection')}
                  style={styles.galleryThumb}
                  resizeMode="cover"
                />
              </TouchableOpacity>
            </>
          )}
        </View>
        <SectionHeader title="Client Reviews" />
        {reviews.length === 0 ? (
          <Card style={styles.block}>
            <Text style={styles.reviewName}>No reviews yet</Text>
            <Text style={styles.reviewComment}>
              Reviews come only from completed NAHTREEK bookings, so every rating here is from a real customer.
            </Text>
          </Card>
        ) : null}
        {reviews.map(review => (
          <Card key={review.name} style={styles.block}>
            <View style={styles.reviewTop}>
              <Text style={styles.reviewName}>{review.name}</Text>
              <RatingStars rating={review.rating} />
            </View>
            <Text style={styles.reviewComment}>{review.comment}</Text>
            <Text style={styles.reviewDate}>{review.date}</Text>
          </Card>
        ))}
      </ScrollView>

      <View
        style={[
          styles.ctaBar,
          {paddingBottom: Math.max(insets.bottom, Spacing.sm) + Spacing.xs},
        ]}>
        <TouchableOpacity
          style={styles.ctaMessage}
          accessibilityLabel="Messaging becomes available once you have a request with this engineer"
          onPress={() =>
            toast(
              'Send a request first — messaging opens as soon as your request exists, before acceptance.',
              'info',
            )
          }>
          <Icon name={ICONS.messages} size={18} color={Colors.navyDeep} />
        </TouchableOpacity>
        <Button
          label={consultationFeeLabel}
          onPress={() =>
            token ? setSheet(true) : navigation.navigate('Login')
          }
          style={styles.cta}
        />
      </View>

      {sheet && (
        <ConsultationSheet
          engineer={engineer}
          onClose={() => setSheet(false)}
          onTrack={track}
          planPrefill={planSheetPrefill(planDraft)}
          onCreate={async payload => {
            if (planId) {
              return requestPlanQuotes(planId, {
                ...payload,
                engineerProfileId: engineer.id,
              });
            }
            return createRequest.mutateAsync({
              ...payload,
              engineerProfileId: engineer.id,
            });
          }}
        />
      )}

      <GalleryViewer
        visible={galleryIndex !== null}
        images={galleryItems}
        index={galleryIndex ?? 0}
        onClose={() => setGalleryIndex(null)}
        onIndexChange={setGalleryIndex}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.offWhite,
  },
  cover: {
    height: 150,
    overflow: 'hidden',
    backgroundColor: Colors.slate100,
    marginHorizontal: -Spacing.lg,
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  body: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  avatarOverlap: {
    marginTop: -32,
    borderWidth: 3,
    borderColor: Colors.offWhite,
    marginBottom: Spacing.md,
  },
  summary: {
    marginBottom: Spacing.md,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    flexWrap: 'wrap',
  },
  name: {
    ...Typography.h3,
    color: Colors.slate900,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
  },
  meta: {
    ...Typography.caption,
    color: Colors.slate600,
  },
  dot: {
    color: Colors.slate300,
  },
  slotChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: Colors.successBg,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 4,
    marginTop: Spacing.md,
  },
  slotLabel: {
    ...Typography.badge,
    color: Colors.success,
  },
  about: {
    ...Typography.body,
    color: Colors.slate600,
    marginBottom: Spacing.lg,
  },
  block: {
    marginBottom: Spacing.sm,
  },
  credRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
    alignItems: 'center',
  },
  workThumb: {
    width: 52,
    height: 52,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.slate100,
  },
  rowInfo: {
    flex: 1,
  },
  credTitle: {
    ...Typography.subtitle,
    fontWeight: '600',
    color: Colors.slate800,
  },
  credSub: {
    ...Typography.caption,
    color: Colors.slate500,
    marginTop: 2,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginBottom: Spacing.lg,
  },
  areaChip: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.slate200,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  areaLabel: {
    ...Typography.caption,
    color: Colors.slate600,
  },
  galleryRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  galleryThumbWrap: {
    flex: 1,
  },
  galleryThumb: {
    flex: 1,
    height: 84,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.slate200,
  },

  reviewTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reviewName: {
    ...Typography.subtitle,
    fontWeight: '700',
    color: Colors.slate800,
  },
  reviewComment: {
    ...Typography.body,
    color: Colors.slate600,
    marginTop: Spacing.xs,
  },
  reviewDate: {
    ...Typography.badge,
    color: Colors.slate400,
    marginTop: Spacing.xs,
  },
  ctaBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.slate100,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  cta: {
    flex: 1,
  },
  ctaMessage: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.slate200,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.sm,
  },
});
