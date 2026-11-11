import {ScreenHeader} from '../components/ScreenHeader';
import {KeyboardAwareView} from '../../../../packages/mobile-ui/KeyboardAwareView';
import React, {useState} from 'react';
import {
  Animated,
  Image,
  TextInput,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {useNavigation} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useQuery} from '@tanstack/react-query';
import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from '@nahtreek/design-system';
import type {ProfileStackParamList} from '../navigation/types';
import {ProColors} from '../theme/professionalTheme';
import {api} from '../services/apiClient';
import {useSessionStore} from '../stores/session';
import {ScreenLoading} from '../components/ScreenLoading';
import {usePortfolioPhotos} from '../hooks/usePortfolioPhotos';
import {mediaUrl} from '../services/media';
import {PrimaryButton} from '../components/PrimaryButton';
import {ScrollMotionBar, useScrollMotion} from '../components/ScrollMotionBar';

type Profile = {
  avatarUrl?: string;
  fullName: string;
  title: string;
  bio?: string;
  yearsOfExperience: number;
  verificationStatus: string;
  serviceCategories: string[];
  startingPrice?: number;
  baseCity: string;
  baseState: string;
  completedJobs?: number;
  rating?: number;
  reviewCount?: number;
  portfolioItems?: {
    id: string;
    title: string;
    description?: string;
    imageUrl: string;
  }[];
  engineerProfile?: {
    qualificationDegree?: string;
    institution?: string;
    graduationYear?: number;
    consultationFee?: number;
    specializations?: {
      specializationId: string;
      specialization?: {name: string};
    }[];
  };
};
type Response = {
  professionalType: 'CIVIL_ENGINEER' | 'SERVICE_PROFESSIONAL';
  profile: Profile | null;
};

export function PublicProfilePreviewScreen() {
  const scrollMotion = useScrollMotion();
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const user = useSessionStore(state => state.user);
  const catalogue = useQuery({
    queryKey: ['service-categories'],
    queryFn: () =>
      api.get<{id: string; slug: string; title: string}[]>('/discovery/services'),
    staleTime: 300_000,
  });
  const serviceNames = Object.fromEntries(
    (catalogue.data ?? []).flatMap(item => [[item.slug, item.title], [item.id, item.title]]),
  );
  const query = useQuery({
    queryKey: ['professional-profile'],
    queryFn: () => api.get<Response>('/professionals/me'),
  });
  const {photoTitle, setPhotoTitle, uploading, uploadError, addWorkPhoto, removePhoto} =
    usePortfolioPhotos(() => query.refetch());
  if (query.isPending) {
    return <ScreenLoading label="Opening your public profile…" rows={5} />;
  }
  if (query.isError || !query.data?.profile) {
    return (
      <View
        style={[
          styles.root,
          {padding: Spacing.lg, paddingTop: insets.top + Spacing.lg},
        ]}>
        <Text style={styles.name}>Your public profile</Text>
        <Text style={styles.title}>
          We could not load your profile. Your saved details have not been
          changed.
        </Text>
        <PrimaryButton
          label="Try again"
          onPress={() => void query.refetch()}
          style={{marginTop: Spacing.lg}}
        />
        <PrimaryButton
          label="Go back"
          onPress={() => navigation.goBack()}
          style={{marginTop: Spacing.md}}
        />
      </View>
    );
  }
  const profile = query.data?.profile;
  const engineer =
    query.data?.professionalType === 'CIVIL_ENGINEER' ||
    user?.roles.includes('ENGINEER');
  const name = profile?.fullName || user?.fullName || 'Your name';
  const title =
    profile?.title || (engineer ? 'Civil Engineer' : 'Service Professional');
  const verified = profile?.verificationStatus === 'VERIFIED';
  const skills = engineer
    ? (profile?.engineerProfile?.specializations ?? [])
        .map(item => item.specialization?.name)
        .filter((item): item is string => Boolean(item))
    : (profile?.serviceCategories ?? []).map(
        item => serviceNames[item] ?? item,
      );
  const price = engineer
    ? profile?.engineerProfile?.consultationFee
    : profile?.startingPrice;

  return (
    <KeyboardAwareView style={styles.root}>
      <ScreenHeader
        title="Your public profile"
        subtitle="See what customers see"
        onBack={() => navigation.goBack()}
        right={
          <Pressable
            accessibilityLabel="Edit profile"
            onPress={() => navigation.navigate('ProfessionalSetup')}
            style={styles.edit}>
            <MaterialCommunityIcons
              name="pencil-outline"
              size={22}
              color={ProColors.onAccent}
            />
          </Pressable>
        }
      />
      <ScrollMotionBar offset={scrollMotion.offset} reducedMotion={scrollMotion.reducedMotion} />
      <Animated.ScrollView onScroll={scrollMotion.onScroll} scrollEventThrottle={16} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.cover}>
          <View style={styles.coverShade}>
            <Text style={styles.coverLabel}>
              {engineer
                ? 'ENGINEERING PROFESSIONAL'
                : 'HOME SERVICE PROFESSIONAL'}
            </Text>
          </View>
        </View>
        <View style={styles.profileCard}>
          <View style={styles.identityRow}>
            {profile?.avatarUrl ? (
              <Image
                source={{uri: mediaUrl(profile.avatarUrl)}}
                style={styles.avatar}
              />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarText}>
                  {name.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.flex}>
              <View style={styles.nameRow}>
                <Text style={styles.name}>{name}</Text>
                {verified ? (
                  <MaterialCommunityIcons
                    name="check-decagram"
                    size={20}
                    color={Colors.success}
                  />
                ) : null}
              </View>
              <Text style={styles.title}>{title}</Text>
              <View style={styles.location}>
                <MaterialCommunityIcons
                  name="map-marker-outline"
                  size={16}
                  color={Colors.slate500}
                />
                <Text style={styles.meta}>
                  {profile?.baseCity || user?.city || 'Work area not added'}
                  {profile?.baseState ? `, ${profile.baseState}` : ''}
                </Text>
              </View>
            </View>
          </View>
          {!profile ? (
            <View style={styles.notice}>
              <MaterialCommunityIcons
                name="information-outline"
                size={21}
                color={Colors.navyMid}
              />
              <Text style={styles.noticeText}>
                Complete your work details to make this profile useful to
                customers.
              </Text>
            </View>
          ) : null}
          <View style={styles.stats}>
            <Stat
              value={profile?.rating?.toFixed(1) ?? 'New'}
              label="Rating"
              icon="star"
            />
            <View style={styles.statLine} />
            <Stat
              value={
                profile?.completedJobs == null
                  ? '—'
                  : String(profile.completedJobs)
              }
              label="Completed"
              icon="briefcase-check"
            />
            <View style={styles.statLine} />
            <Stat
              value={
                profile?.yearsOfExperience == null
                  ? '—'
                  : `${profile.yearsOfExperience} ${
                      profile?.yearsOfExperience === 1 ? 'year' : 'years'
                    }`
              }
              label="Experience"
              icon="medal-outline"
            />
          </View>
        </View>

        <Section title="About my work">
          <Text style={styles.body}>
            {profile?.bio ||
              'Add a short explanation of the work you do and how you help customers.'}
          </Text>
        </Section>
        <Section
          title={engineer ? 'Engineering services' : 'Services I provide'}>
          {skills.length ? (
            <View style={styles.chips}>
              {skills.map(item => (
                <View key={item} style={styles.chip}>
                  <MaterialCommunityIcons
                    name="check"
                    size={16}
                    color={Colors.success}
                  />
                  <Text style={styles.chipText}>{item}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyText}>No services added yet.</Text>
          )}
        </Section>
        {price ? (
          <View style={styles.priceCard}>
            <View style={styles.priceIcon}>
              <MaterialCommunityIcons
                name="currency-inr"
                size={24}
                color={Colors.navyDeep}
              />
            </View>
            <View style={styles.flex}>
              <Text style={styles.priceLabel}>
                {engineer
                  ? 'Consultation starts from'
                  : 'Service visit starts from'}
              </Text>
              <Text style={styles.price}>₹{price.toLocaleString('en-IN')}</Text>
            </View>
          </View>
        ) : null}
        {engineer && profile?.engineerProfile?.qualificationDegree ? (
          <Section title="Qualification">
            <View style={styles.qualification}>
              <MaterialCommunityIcons
                name="school-outline"
                size={24}
                color={Colors.navyMid}
              />
              <View style={styles.flex}>
                <Text style={styles.qualificationTitle}>
                  {profile.engineerProfile.qualificationDegree}
                </Text>
                <Text style={styles.meta}>
                  {profile.engineerProfile.institution}
                  {profile.engineerProfile.graduationYear
                    ? ` · ${profile.engineerProfile.graduationYear}`
                    : ''}
                </Text>
              </View>
            </View>
          </Section>
        ) : null}
        <Section title="Work photos">
          {profile?.portfolioItems?.length ? (
            profile.portfolioItems.map(item => (
              <View key={item.id} style={styles.portfolio}>
                <PortfolioImage uri={mediaUrl(item.imageUrl)} />
                <View style={styles.portfolioCopy}>
                  <Text style={styles.qualificationTitle}>{item.title}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${item.title}`}
                    onPress={() => removePhoto(item.id, item.title)}
                    style={{minHeight: 48, justifyContent: 'center'}}>
                    <Text style={{color: Colors.error}}>Remove photo</Text>
                  </Pressable>
                  {item.description ? (
                    <Text style={styles.meta}>{item.description}</Text>
                  ) : null}
                </View>
              </View>
            ))
          ) : (
            <View style={styles.emptyPortfolio}>
              <MaterialCommunityIcons
                name="image-plus"
                size={30}
                color={Colors.slate400}
              />
              <Text style={styles.emptyText}>
                Add clear photos of your own completed work.
              </Text>
            </View>
          )}
          <TextInput
            accessibilityLabel="Work photo title"
            placeholder="Describe this work briefly"
            value={photoTitle}
            onChangeText={setPhotoTitle}
            maxLength={120}
            style={{
              borderWidth: 1,
              borderColor: Colors.slate200,
              borderRadius: 12,
              padding: 14,
              marginVertical: 12,
              color: Colors.slate900,
            }}
          />
          <Text style={styles.meta}>
            Only upload your own work. These photos are public; do not upload
            identity documents.
          </Text>
          {uploadError ? (
            <Text
              accessibilityRole="alert"
              style={{color: Colors.error, marginVertical: 8}}>
              {uploadError}
            </Text>
          ) : null}
          <PrimaryButton
            label="Add work photo"
            loading={uploading}
            onPress={addWorkPhoto}
            style={{marginTop: 12}}
          />
        </Section>
        <View style={styles.previewNote}>
          <MaterialCommunityIcons
            name="eye-outline"
            size={20}
            color={Colors.navyMid}
          />
          <Text style={styles.previewText}>
            View only. Customers can contact you after your profile is
            approved and matched to their request.
          </Text>
        </View>
      </Animated.ScrollView>
    </KeyboardAwareView>
  );
}

function PortfolioImage({uri}: {uri?: string}) {
  const [failed, setFailed] = useState(false);
  if (failed || !uri) {
    return (
      <View style={[styles.portfolioImage, styles.portfolioImageFallback]}>
        <MaterialCommunityIcons
          name="image-off-outline"
          size={32}
          color={Colors.slate500}
        />
        <Text style={styles.meta}>Photo unavailable</Text>
      </View>
    );
  }
  return (
    <Image
      source={{uri}}
      style={styles.portfolioImage}
      onError={() => setFailed(true)}
    />
  );
}

function Stat({
  value,
  label,
  icon,
}: {
  value: string;
  label: string;
  icon: string;
}) {
  return (
    <View style={styles.stat}>
      <MaterialCommunityIcons name={icon} size={18} color={Colors.navyMid} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}
function Section({title, children}: React.PropsWithChildren<{title: string}>) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: Colors.offWhite},
  flex: {flex: 1, minWidth: 0},
  topBar: {
    minHeight: 92,
    paddingTop: Spacing.lg,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.navyDeep,
  },
  back: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center'},
  edit: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: ProColors.accent,
  },
  topTitle: {...Typography.h2, color: Colors.white},
  topText: {...Typography.caption, color: Colors.slate300},
  content: {paddingBottom: Spacing.xxl},
  cover: {
    marginHorizontal: 20,
    marginTop: 20,
    borderRadius: 16,
    backgroundColor: Colors.navyDeep,
  },
  coverImage: {resizeMode: 'cover'},
  coverShade: {padding: 20},
  coverLabel: {
    ...Typography.badge,
    lineHeight: 16,
    color: Colors.white,
    letterSpacing: 1,
  },
  profileCard: {
    marginHorizontal: 20,
    marginTop: 12,
    padding: 20,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.slate200,
  },
  identityRow: {flexDirection: 'row', alignItems: 'center', gap: Spacing.md},
  avatar: {width: 66, height: 66, borderRadius: 33},
  avatarFallback: {
    width: 66,
    height: 66,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 33,
    backgroundColor: Colors.navyMid,
  },
  avatarText: {...Typography.h1, color: Colors.white},
  nameRow: {flexDirection: 'row', alignItems: 'center', gap: 5},
  name: {...Typography.h2, color: Colors.slate900, flexShrink: 1},
  title: {...Typography.body, color: Colors.slate700, marginTop: 2},
  location: {flexDirection: 'row', alignItems: 'center', marginTop: 4},
  meta: {...Typography.caption, color: Colors.slate500, flexShrink: 1},
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.sm,
    marginTop: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.slate200,
  },
  noticeText: {...Typography.caption, color: Colors.navyDeep, flex: 1},
  stats: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.slate100,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  statLine: {width: 1, height: 42, backgroundColor: Colors.slate200},
  statValue: {...Typography.h3, color: Colors.slate900},
  statLabel: {
    ...Typography.caption,
    color: Colors.slate500,
    textAlign: 'center',
  },
  section: {
    marginHorizontal: 20,
    marginTop: Spacing.md,
    padding: 20,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.slate200,
  },
  sectionTitle: {
    ...Typography.h3,
    color: Colors.slate900,
    marginBottom: Spacing.sm,
  },
  body: {...Typography.body, color: Colors.slate700},
  chips: {flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm},
  chip: {
    minHeight: 38,
    maxWidth: '100%',
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.successBg,
  },
  chipText: {
    flexShrink: 1,
    ...Typography.caption,
    color: Colors.slate800,
    fontWeight: '600',
  },
  emptyText: {...Typography.body, color: Colors.slate500},
  priceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginHorizontal: 20,
    marginTop: Spacing.md,
    padding: 20,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.slate100,
  },
  priceIcon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priceLabel: {...Typography.caption, color: Colors.slate600},
  price: {...Typography.h2, color: Colors.navyDeep},
  qualification: {flexDirection: 'row', alignItems: 'center', gap: Spacing.md},
  qualificationTitle: {
    ...Typography.body,
    color: Colors.slate900,
    fontWeight: '700',
  },
  portfolio: {
    overflow: 'hidden',
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.offWhite,
  },
  portfolioImage: {width: '100%', height: 150},
  portfolioImageFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.offWhite,
  },
  portfolioCopy: {padding: Spacing.sm},
  emptyPortfolio: {
    minHeight: 92,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.offWhite,
  },
  previewNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    margin: Spacing.md,
    padding: 20,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.slate200,
  },
  previewText: {...Typography.caption, color: Colors.navyDeep, flex: 1},
});
