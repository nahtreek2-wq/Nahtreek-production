import React, {useState} from 'react';
import {
  Image,
  ImageBackground,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Animated, {FadeInDown, ReduceMotion} from 'react-native-reanimated';
import {Motion} from '../../../../packages/mobile-ui/motion';
import {useNavigation} from '@react-navigation/native';
import {useBottomTabBarHeight} from '@react-navigation/bottom-tabs';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Colors, Spacing} from '@nahtreek/design-system';
import {Avatar, BottomSheet, Icon, ICONS, SectionHeader} from '../components/ui';
import {CATEGORY_SERVICE_IDS, CategoryGrid} from '../components/home/CategoryGrid';
import {HomeSkeleton} from '../components/SkeletonLoader';
import {ActiveBookingBar} from '../components/home/ActiveBookingBar';
import {BookAgainStrip} from '../components/home/BookAgainStrip';
import {TrustStrip} from '../components/home/TrustStrip';
import {LocationPicker} from '../components/LocationPicker';
import {stateForCity} from '../services/geography';
import {StateDistrictFields} from '../components/StateDistrictFields';
import {useCity} from '../stores/city';
import {useSessionStore} from '../stores/session';
import {useToast} from '../stores/toast';
import {
  useClientProfile,
  useEngineList,
  useFavoritesList,
  useUpdateClientProfile,
} from '../services/queries';
import {HERO_PHOTOS, portraitFor} from '../assets/imagery';
import {mediaUrl} from '../services/media';
import {
  usePlatformHistory,
  type ServiceRequest,
} from '../services/platformQueries';
import {ClientColors} from '../design-system/tokens';
import type {RootStackParamList} from '../navigation/types';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

type Nav = NativeStackNavigationProp<RootStackParamList>;
const NAVY = ClientColors.deepNavy;
const PRIMARY_NAVY = ClientColors.primaryNavy;
const ACCENT = ClientColors.accent;
const STAR_GOLD = '#E8AD43';
const PAPER = ClientColors.lightBackground;
const TEXT = ClientColors.primaryText;
const MUTED = ClientColors.secondaryText;
const BORDER = ClientColors.border;
const ACCENT_SOFT = ClientColors.accentSoft;
const ICON_TONES = {
  ai: {color: ClientColors.white},
  engineers: {color: Colors.interactiveBlue},
  saved: {color: '#C2415A'},
} as const;

const HEROES = [
  {
    key: 'engineers',
    image: HERO_PHOTOS.planning,
    eyebrow: 'START WITH THE RIGHT EXPERT',
    title: 'Plan your project with confidence',
    subtitle: 'Find verified professionals for every important decision.',
    action: 'Find professionals',
  },
];


export function HomeScreen() {
  const {width, height} = useWindowDimensions();
  const compact = width < 360 || height < 700;
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const city = useCity(state => state.city);
  const selectedState = useCity(state => state.state);
  const setCity = useCity(state => state.setCity);
  const isGuest = useSessionStore(state => state.isGuest);
  const user = useSessionStore(state => state.user);
  const profile = useClientProfile();
  const updateProfile = useUpdateClientProfile();
  const serviceRequests = usePlatformHistory('service-requests');
  const bookAgainItems = (serviceRequests.data?.pages.flatMap(page => page.data) ?? [])
    .filter((item): item is ServiceRequest => 'status' in item && item.status === 'COMPLETED')
    .slice(0, 3)
    .map(item => ({
      id: item.category.slug ?? item.category.id,
      title: item.category.title,
      detail: `${item.provider.fullName} · ${new Date(item.createdAt).toLocaleDateString('en-IN', {day: 'numeric', month: 'short'})}`,
    }));
  const favorites = useFavoritesList();
  const engineers = useEngineList('top', undefined, city, selectedState);
  const toast = useToast();
  const [locationOpen, setLocationOpen] = useState(false);
  const [locationState, setLocationState] = useState(selectedState);
  const hero = HEROES[0];
  const openDiscovery = () => navigation.navigate('EngineerDiscovery');
  const openSearch = () => navigation.navigate('Search');
  const selectCity = (nextCity: string, nextState?: string) => {
    if (!user || isGuest) {
      setCity(nextCity, nextState);
      setLocationOpen(false);
      return;
    }
    updateProfile.mutate(
      {city: nextCity, state: nextState ?? stateForCity(nextCity)},
      {
        onSuccess: saved => {
          if (saved.userId !== useSessionStore.getState().user?.id) return;
          setCity(saved.city ?? nextCity, saved.state ?? nextState);
          setLocationOpen(false);
          toast('Home location updated', 'success');
        },
        onError: error =>
          toast(
            error instanceof Error
              ? error.message
              : 'Could not update your home location',
            'error',
          ),
      },
    );
  };
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={NAVY} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{paddingBottom: tabBarHeight + 24}}>
      <LinearGradient
          colors={[NAVY, PRIMARY_NAVY]}
          style={[styles.header, compact && styles.compactHeader, {paddingTop: insets.top + 10}]}>
          <View style={styles.headerRow}>
            <View style={[styles.logoFrame, compact && styles.compactLogo]} accessibilityRole="image" accessibilityLabel="Nahtreek logo">
              <Image source={require('../assets/nahtreek_home_mark.png')} style={[styles.logo, compact && styles.compactLogo]} />
            </View>
            <View style={styles.brandBlock}>
              <Text numberOfLines={1} allowFontScaling={false} style={[styles.brand, compact && styles.compactBrand]}>NAHTREEK</Text>
              <View style={styles.tagRow}>
                <Text numberOfLines={1} allowFontScaling={false} style={[styles.productName, compact && styles.compactProductName]}>HOME</Text>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={10}
                  accessibilityLabel={`Change city, current ${city || 'not selected'}`}
                  onPress={() => {setLocationState(selectedState); setLocationOpen(true);}}
                  style={styles.cityRow}>
                  {!compact && <Icon name={ICONS.location} size={14} color={ClientColors.accent} />}
                  <Text numberOfLines={1} style={[styles.city, compact && styles.compactCity]}>{city || 'Choose your city'}</Text>
                  <Icon name={ICONS.chevronDown} size={compact ? 12 : 14} color={ClientColors.accent} />
                </Pressable>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Notifications"
              onPress={() => navigation.navigate('Notifications')}
              style={[styles.iconButton, compact && styles.compactIconButton]}>
              <Icon name={ICONS.bell} size={compact ? 18 : 21} color={ClientColors.white} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Your profile"
              style={[styles.profileTarget, compact && styles.compactProfileTarget]}
              onPress={() =>
                navigation.navigate('MainTabs', {screen: 'Profile'})
              }>
              {user ? (
                <Avatar
                  name={profile.data?.fullName ?? user.fullName}
                  uri={profile.data?.avatarUrl ?? user.avatarUrl}
                  size={compact ? 28 : 36}
                  light
                />
              ) : (
                <View style={[styles.iconButton, compact && styles.compactIconButton]}>
                  <Icon name={ICONS.profile} size={24} color={ClientColors.white} />
                </View>
              )}
            </Pressable>
          </View>
          <Animated.View entering={FadeInDown.duration(Motion.entrance).delay(60).reduceMotion(ReduceMotion.System)}>
            <Text numberOfLines={1} style={[styles.greeting, compact && styles.compactGreeting]}>
              {user ? `Hello, ${profile.data?.fullName ?? user.fullName}` : 'Make yourself at home'}
            </Text>
            {compact ? null : <Text style={styles.greetingText}>Find trusted help nearby.</Text>}
            <Pressable
              style={({pressed}) => [styles.searchBox, pressed && styles.searchPressed]}
              onPress={openSearch}
              accessibilityRole="button"
              accessibilityLabel="Search professionals and services">
              <Icon name={ICONS.search} size={21} color={MUTED} />
              <Text numberOfLines={1} style={styles.searchInput}>Search services</Text>
            </Pressable>
          </Animated.View>
      </LinearGradient>
        {user ? <ActiveBookingBar /> : null}
        <View style={styles.body}>
          <View style={styles.planCard}>
            <ImageBackground
              source={hero.image}
              style={styles.planImage}
              imageStyle={styles.planImageRadius}>
              <LinearGradient
                colors={['rgba(7,31,61,0.25)', 'rgba(7,31,61,0.88)']}
                style={styles.planOverlay}>
                <Text style={styles.planEyebrow}>{hero.eyebrow}</Text>
                <Text style={styles.planTitle}>{hero.title}</Text>
                <Text style={styles.planSubtitle}>{hero.subtitle}</Text>
              </LinearGradient>
            </ImageBackground>
            <View style={styles.planActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={hero.action}
                onPress={openDiscovery}
                style={({pressed}) => [styles.planPrimary, pressed && styles.planPressed]}>
                <Text numberOfLines={1} adjustsFontSizeToFit style={styles.planPrimaryText}>{hero.action}</Text>
                <Icon name={ICONS.chevronRight} size={17} color={ClientColors.onAccent} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Plan your project with NAHTREEK AI"
                onPress={() => navigation.navigate('AiPlanner')}
                style={({pressed}) => [styles.planSecondary, pressed && styles.planPressed]}>
                <Icon name={ICONS.ai} size={17} color={ICON_TONES.ai.color} />
                <Text numberOfLines={1} adjustsFontSizeToFit style={styles.planSecondaryText}>Ask AI</Text>
              </Pressable>
            </View>
          </View>
          <CategoryGrid
            onSelectService={serviceKey => {
              const serviceId = CATEGORY_SERVICE_IDS[serviceKey];
              navigation.navigate('Services', serviceId ? {serviceId} : undefined);
            }}
            onSelectEngineers={openDiscovery}
          />
          <BookAgainStrip
            items={bookAgainItems}
            onSelect={serviceId => navigation.navigate('Services', {serviceId})}
          />
          <View style={styles.sectionSpacer}><SectionHeader title="Your workspace" /></View>
          <View style={styles.workRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Home service requests"
              style={({pressed}) => [styles.workTile, pressed && styles.workTilePressed]}
              onPress={() =>
                navigation.navigate(user ? 'ServiceHistory' : 'Login')
              }>
              <View style={styles.workIcon}>
                <Icon name={ICONS.plumbing} size={22} color={ClientColors.accentIcon} />
              </View>
              <Text numberOfLines={1} adjustsFontSizeToFit style={styles.workTitle}>Services</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Engineering requests"
              style={({pressed}) => [styles.workTile, pressed && styles.workTilePressed]}
              onPress={() =>
                user
                  ? navigation.navigate('MainTabs', {screen: 'Requests'})
                  : navigation.navigate('Login')
              }>
              <View style={styles.workIcon}>
                <Icon name={ICONS.engineers} size={22} color={ICON_TONES.engineers.color} />
              </View>
              <Text numberOfLines={1} adjustsFontSizeToFit style={styles.workTitle}>Engineers</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Your saved professionals"
              style={({pressed}) => [styles.workTile, pressed && styles.workTilePressed]}
              onPress={() => navigation.navigate(user ? 'Saved' : 'Login')}>
              <View style={styles.workIcon}>
                <Icon name={ICONS.heartOutline} size={22} color={ICON_TONES.saved.color} />
              </View>
              <Text numberOfLines={1} adjustsFontSizeToFit style={styles.workTitle}>Saved</Text>
              {favorites.data.length ? (
                <Text style={styles.workCount}>{favorites.data.length} saved</Text>
              ) : null}
            </Pressable>
          </View>
          {engineers.isLoading ? (
            <View style={styles.sectionSpacer}><HomeSkeleton /></View>
          ) : engineers.data.length ? (
            <>
              <View style={styles.sectionSpacer}><SectionHeader
                title="Top professionals"
                actionLabel="View all"
                onAction={openDiscovery}
              /></View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.proRow}>
                {engineers.data.slice(0, 4).map(engineer => (
                  <Pressable
                    key={engineer.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${engineer.fullName}`}
                    onPress={() =>
                      navigation.navigate('EngineerProfile', {
                        engineerId: engineer.id,
                      })
                    }
                    style={({pressed}) => [styles.proCard, pressed && styles.proCardPressed]}>
                    <Image
                      source={
                        engineer.avatarUrl
                          ? {uri: mediaUrl(engineer.avatarUrl)}
                          : portraitFor(engineer.id) ?? HERO_PHOTOS.planning
                      }
                      style={styles.proImage}
                    />
                    <View style={styles.proCopy}>
                      <Text style={styles.proName}>
                        {engineer.fullName}
                      </Text>
                      <Text style={styles.proSpecialty}>
                        {engineer.specializations[0]}
                      </Text>
                      <View style={styles.proMeta}>
                        {engineer.totalReviewsCount > 0 ? (
                          <>
                            <Icon name={ICONS.star} size={13} color={STAR_GOLD} />
                            <Text style={styles.proRating}>{engineer.averageRating.toFixed(1)} · {engineer.totalReviewsCount} reviews</Text>
                          </>
                        ) : <Text style={styles.proRating}>New profile</Text>}
                      </View>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          ) : null}
          {!user ? (
            <>
              <View style={styles.sectionSpacer}><SectionHeader title="Save your work" /></View>
              <View style={styles.actionStack}>
                <Pressable
                  accessibilityRole="button"
                  style={({pressed}) => [styles.actionCard, pressed && styles.actionCardPressed]}
                  onPress={() => navigation.navigate('Login', {mode: 'create'})}>
                  <View style={styles.actionIcon}>
                    <Icon name={ICONS.profile} size={24} color={ClientColors.accentIcon} />
                  </View>
                  <View style={styles.actionCopy}>
                    <Text style={styles.actionTitle}>Create your account</Text>
                    <Text style={styles.actionText}>
                      Keep requests, messages and saved professionals together
                    </Text>
                  </View>
                  <Icon name={ICONS.chevronRight} size={20} color={MUTED} />
                </Pressable>
              </View>
            </>
          ) : null}
          <TrustStrip />
        </View>
      </ScrollView>
      <BottomSheet
        visible={locationOpen}
        title="Choose your location"
        subtitle="Search for a place or choose a district"
        onClose={() => {setLocationOpen(false); setLocationState(selectedState);}}>
        <LocationPicker
          onSelect={item => {
            if (!item.city) {
              toast('Please choose a location with a city', 'error');
              return;
            }
            if (!user || isGuest) {
              setCity(item.city, item.state);
              setLocationOpen(false);
              return;
            }
            updateProfile.mutate(
              {
                city: item.city,
                state: item.state || undefined,
                latitude: item.latitude,
                longitude: item.longitude,
              },
              {
                onSuccess: saved => {
                  if (saved.userId !== useSessionStore.getState().user?.id)
                    return;
                  setCity(saved.city ?? item.city, saved.state ?? item.state);
                  setLocationOpen(false);
                },
                onError: error => toast(error.message, 'error'),
              },
            );
          }}
        />
        <Text style={styles.locationLabel}>Or choose a state and district</Text>
        <StateDistrictFields
          state={locationState}
          district={city}
          onStateChange={nextState => setLocationState(nextState)}
          onDistrictChange={nextDistrict => {if (nextDistrict) selectCity(nextDistrict, locationState);}}
        />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: PAPER},
  header: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: 16,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  compactHeader: {paddingHorizontal: 16, paddingBottom: 10},
  greeting: {fontSize: 19, lineHeight: 25, fontWeight: '700', color: ClientColors.white, marginTop: 10},
  compactGreeting: {marginTop: 6},
  greetingText: {fontSize: 14, lineHeight: 20, color: Colors.slate200, marginTop: 3},
  profileTarget: {minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', alignSelf: 'center'},
  compactProfileTarget: {minWidth: 36},
  headerRow: {minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8},
  logoFrame: {width: 46, height: 46, overflow: 'hidden', justifyContent: 'center', alignSelf: 'center', flexShrink: 0},
  logo: {width: 46, height: 46, resizeMode: 'contain'},
  compactLogo: {width: 36, height: 36},
  brandBlock: {flex: 1, minWidth: 0, justifyContent: 'center', gap: 0},
  brand: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '800',
    letterSpacing: 1,
    color: ClientColors.white,
    includeFontPadding: false,
  },
  compactBrand: {fontSize: 17, lineHeight: 21, letterSpacing: 0.8},
  tagRow: {flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 1},
  productName: {fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 3, color: ClientColors.accent, includeFontPadding: false, flexShrink: 0},
  compactProductName: {fontSize: 11, lineHeight: 14, letterSpacing: 2},
  cityRow: {flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1, minWidth: 0},
  city: {fontSize: 14, lineHeight: 19, color: ClientColors.white, flexShrink: 1, includeFontPadding: false},
  compactCity: {fontSize: 12, lineHeight: 17},
  iconButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  compactIconButton: {width: 36, height: 36},
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: ACCENT_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {fontSize: 13, fontWeight: '800', color: '#FFF'},
  searchBox: {
    minHeight: 46,
    paddingVertical: 8,
    marginTop: 10,
    borderRadius: 16,
    backgroundColor: '#FFF',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 10,
  },
  searchInput: {flex: 1, color: MUTED, fontSize: 15, lineHeight: 22},
  searchPressed: {backgroundColor: '#EDF2F8'},
  body: {paddingHorizontal: 20, paddingTop: 12},

  planCard: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: NAVY,
  },
  planImage: {height: 96},
  planImageRadius: {borderRadius: 0},
  planOverlay: {flex: 1, padding: 14, justifyContent: 'flex-end'},
  planEyebrow: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: ClientColors.white,
    marginBottom: 3,
    textShadowColor: 'rgba(7,31,61,0.9)',
    textShadowOffset: {width: 0, height: 1},
    textShadowRadius: 3,
  },
  planTitle: {
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '800',
    color: ClientColors.white,
  },
  planSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    color: Colors.slate200,
    marginTop: 2,
  },
  planActions: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
  },
  planPressed: {opacity: 0.88},
  planPrimary: {
    flex: 1.5,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: ACCENT,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  planPrimaryText: {fontSize: 15, lineHeight: 20, fontWeight: '800', color: ClientColors.onAccent, flexShrink: 1},
  planSecondary: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  planSecondaryText: {fontSize: 13, fontWeight: '800', color: ClientColors.white, flexShrink: 1},
  workRow: {flexDirection: 'row', gap: 10, marginTop: 12},
  workTile: {
    flex: 1,
    minHeight: 104,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: ClientColors.white,
    paddingVertical: 12,
    paddingHorizontal: 6,
    alignItems: 'center',
    gap: 7,
  },
  workTilePressed: {backgroundColor: ClientColors.veryLightBlue},
  workIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workTitle: {fontSize: 12, lineHeight: 16, fontWeight: '800', color: TEXT, textAlign: 'center'},
  workCount: {fontSize: 11, lineHeight: 14, color: MUTED, textAlign: 'center'},

  sectionSpacer: {marginTop: 16},

  needCard: {
    flex: 1,
    minHeight: 132,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: ClientColors.white,
    padding: 14,
  },
  needCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  needType: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  needTitle: {fontSize: 16, fontWeight: '800', color: TEXT},
  needSubtitle: {fontSize: 13, lineHeight: 19, color: MUTED, marginTop: 8},
  startRequest: {
    minHeight: 62,
    marginTop: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#FFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 13,
  },
  startRequestIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startRequestCopy: {flex: 1},
  startRequestTitle: {fontSize: 14, fontWeight: '800', color: TEXT},
  startRequestText: {fontSize: 11, color: MUTED, marginTop: 2},
  proRow: {gap: 12, paddingTop: 12, paddingBottom: 2},
  proCard: {
    width: 208,
    backgroundColor: '#FFF',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: BORDER,
  },
  proCardPressed: {opacity: 0.93},
  proImage: {width: '100%', height: 110},
  proCopy: {padding: 16},
  proName: {fontSize: 16, lineHeight: 22, fontWeight: '700', color: TEXT},
  proSpecialty: {fontSize: 13, lineHeight: 18, color: MUTED, marginTop: 4},
  proMeta: {flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8},
  proRating: {fontSize: 13, lineHeight: 18, fontWeight: '600', color: TEXT},
  actionCardPressed: {backgroundColor: ClientColors.veryLightBlue},
  actionStack: {marginTop: 12, backgroundColor: ClientColors.white, borderRadius: 16, overflow: 'hidden'},
  actionCard: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFF',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
  },
  actionIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCopy: {flex: 1},
  actionTitle: {fontSize: 14, fontWeight: '800', color: TEXT},
  actionText: {fontSize: 13, lineHeight: 18, color: MUTED, marginTop: 3},
  serviceList: {gap: 10, marginTop: 14},
  serviceCard: {
    minHeight: 88,
    backgroundColor: '#FFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  servicePhoto: {width: 62, height: 66, borderRadius: 13},
  serviceCopy: {flex: 1},
  serviceGroup: {
    fontSize: 10,
    fontWeight: '700',
    color: ClientColors.accentText,
    marginBottom: 3,
  },
  serviceTitle: {fontSize: 14, fontWeight: '800', color: TEXT},
  serviceDescription: {
    fontSize: 11,
    lineHeight: 15,
    color: MUTED,
    marginTop: 3,
  },
  supportCard: {
    marginTop: 28,
    borderRadius: 20,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  supportIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supportCopy: {flex: 1},
  supportTitle: {fontSize: 15, fontWeight: '800', color: '#FFF'},
  supportText: {fontSize: 12, lineHeight: 17, color: ClientColors.white, marginTop: 3},
  supportButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  locationRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  locationLabel: {fontSize: 15, color: TEXT, flex: 1},
  locationLabelSelected: {fontWeight: '800', color: NAVY},
});
