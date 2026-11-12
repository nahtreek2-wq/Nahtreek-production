import React, {useMemo, useState} from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import Animated, {FadeInDown, ReduceMotion} from 'react-native-reanimated';
import {Motion, stagger} from '../../../../packages/mobile-ui/motion';
import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useOptionalTabBarHeight} from '../hooks/useOptionalTabBarHeight';
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
  BottomSheet,
  Button,
  Card,
  Icon,
  ICONS,
  MemberBadge,
  RatingStars,
  EmptyState,
  ErrorState,
  OfflineBanner,
} from '../components/ui';
import {EngineerCardSkeleton} from '../components/SkeletonLoader';
import {ConsultationSheet} from '../components/ConsultationSheet';
import {
  useEngineList,
  useCreateRequest,
  useUpdateClientProfile,
} from '../services/queries';
import {useFavoritesList, useToggleFavorite} from '../services/queries';
import {useToast} from '../stores/toast';
import {currentLocation} from '../services/location';
import {isApiConfigured} from '../services/config';
import type {EngineerProfileDto} from '@nahtreek/types';
import {portraitFor} from '../assets/imagery';
import type {RootStackParamList} from '../navigation/types';
import {useSessionStore} from '../stores/session';
import {useCity} from '../stores/city';
import {useListFilters} from '../stores/listFilters';
import {useServiceCategories} from '../services/platformQueries';
import {ClientColors} from '../design-system/tokens';
import {iconographyForService} from '../../../../packages/mobile-ui/serviceIconography';
import type {IconName} from '../components/ui/Icon';
import {DistrictLocationPicker} from '../components/DistrictLocationPicker';
import {planSheetPrefill, usePlanDraft, usePlanQuoteRequest} from '../services/planQuotes';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type DiscoveryRoute = RouteProp<RootStackParamList, 'EngineerDiscovery'>;

const FILTERS = [
  'All',
  'Structural Design',
  'Architectural 3D',
  'Site Plan Approval',
  'Geotechnical',
  'Renovation Audit',
];
const SORTS = ['Top Rated', 'Nearest', 'Available Now', 'Saved'];
const ENGINEER_CATEGORIES = [
  {
    title: 'All engineers',
    subtitle: 'Browse every specialization',
    icon: ICONS.engineers,
    filter: 'All',
  },
  {
    title: 'Structural',
    subtitle: 'Design and safety guidance',
    icon: ICONS.building,
    filter: 'Structural Design',
  },
  {
    title: 'Architecture',
    subtitle: 'Plans and 3D design',
    icon: ICONS.plot,
    filter: 'Architectural 3D',
  },
  {
    title: 'Approvals',
    subtitle: 'Plan and permit support',
    icon: ICONS.verified,
    filter: 'Site Plan Approval',
  },
] as const;

export function EngineerDiscoveryScreen() {
  const categories = useServiceCategories();
  const navigation = useNavigation<Nav>();
  const route = useRoute<DiscoveryRoute>();
  const planId = route.params?.planId;
  const planDraft = usePlanDraft(planId);
  const requestPlanQuotes = usePlanQuoteRequest();
  const isTabScreen = (navigation.getState() as {type: string}).type === 'tab';
  const insets = useSafeAreaInsets();
  const tabBarHeight = useOptionalTabBarHeight();
  const city = useCity(state => state.city);
  const selectedState = useCity(state => state.state);
  const setCity = useCity(state => state.setCity);
  const user = useSessionStore(state => state.user);
  const updateProfile = useUpdateClientProfile();
  const cityName = city.split(',')[0]?.trim() || 'your area';
  const mode = useListFilters(state => state.discoveryMode);
  const setMode = useListFilters(state => state.setDiscoveryMode);
  const filter = useListFilters(state => state.discoveryFilter);
  const setFilter = useListFilters(state => state.setDiscoveryFilter);
  const sort = useListFilters(state => state.discoverySort);
  const setSort = useListFilters(state => state.setDiscoverySort);
  const [geo, setGeo] = useState<{latitude: number; longitude: number} | undefined>();
  const [geoLoading, setGeoLoading] = useState(false);
  const pickSort = async (option: string) => {
    if (option !== 'Nearest') {
      setSort(option);
      return;
    }
    // Nearest needs the customer's position: resolve once, then rank by it.
    if (geo) {
      setSort(option);
      return;
    }
    setGeoLoading(true);
    try {
      const position = await currentLocation();
      setGeo({latitude: position.latitude, longitude: position.longitude});
      setSort(option);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Location is unavailable.', 'error');
    } finally {
      setGeoLoading(false);
    }
  };
  const [filterSheet, setFilterSheet] = useState<'sort' | 'specialization' | null>(null);
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
  const [consult, setConsult] = useState<EngineerProfileDto | null>(null);
  const favoritesQ = useFavoritesList();
  const toggleFavorite = useToggleFavorite();
  const toast = useToast();
  const token = useSessionStore(state => state.accessToken);
  const savedProfessionalIds = (
    (favoritesQ.data ?? []) as {professionalId: string}[]
  ).map(f => f.professionalId);
  const onHeart = (engineer: EngineerProfileDto) => {
    if (!token) {
      navigation.navigate('Login');
      return;
    }
    if (toggleFavorite.isPending) return;
    const isAdding = !savedProfessionalIds.includes(
      engineer.professionalProfileId,
    );
    toggleFavorite.mutate(
      {professionalId: engineer.professionalProfileId, isAdding},
      {
        onSuccess: () =>
          toast(
            isAdding
              ? isApiConfigured
                ? 'Saved to your list'
                : 'Saved on this device'
              : isApiConfigured
              ? 'Removed from saved'
              : 'Removed from this device',
            'success',
          ),
        onError: () =>
          toast(
            'Could not update saved professionals. Please try again.',
            'error',
          ),
      },
    );
  };

  const query = useEngineList(
    sort === 'Available Now' ? 'available' : 'top',
    filter,
    city,
    selectedState,
    sort === 'Nearest' ? geo : undefined,
  );
  const createRequest = useCreateRequest();
  const engineers = useMemo(() => {
    let list = query.data ?? [];
    if (filter !== 'All') {
      list = list.filter(e => e.specializations.includes(filter));
    }
    switch (sort) {
      case 'Nearest':
        list = [...list].sort(
          (a, b) =>
            (a.distanceKm ?? Number.POSITIVE_INFINITY) -
            (b.distanceKm ?? Number.POSITIVE_INFINITY),
        );
        break;
      case 'Available Now':
        list = list.filter(e => e.isAvailable);
        break;
      case 'Saved':
        list = list.filter(e =>
          savedProfessionalIds.includes(e.professionalProfileId),
        );
        break;
      default:
        list = [...list].sort((a, b) => b.averageRating - a.averageRating);
    }
    return list;
  }, [query.data, filter, sort, savedProfessionalIds]);

  const track = (requestId: string) => {
    setConsult(null);
    navigation.navigate('RequestDetail', {requestId});
  };

  return (
    <View style={styles.container}>
      <AppHeader
        title="Find"
        subtitle="Trusted help for your home"
        style={styles.findHeader}
        onBack={!isTabScreen ? () => navigation.goBack() : undefined}
        tab={isTabScreen}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Change search city, current ${city || 'not selected'}`}
            onPress={() => setCityPickerOpen(true)}
            style={styles.changeCityButton}>
            <Icon name={ICONS.location} size={15} color={Colors.navyDeep} />
            <Text style={styles.changeCityText}>{cityName === 'your area' ? 'Set city' : 'Change'}</Text>
          </Pressable>
        }
      />
      <OfflineBanner
        force={mode === 'engineers' && query.isOffline}
        onRetry={query.refetch}
        retrying={query.isRefetching}
        error={query.error}
        hasContent={engineers.length > 0}
      />
      {planId ? (
        <View style={styles.planBanner}>
          <Icon name={ICONS.sparkles} size={16} color={ClientColors.accentText} />
          <Text style={styles.planBannerText} numberOfLines={2}>
            {planDraft ? `Get quotes for “${planDraft.title}” — pick a professional.` : 'Loading your AI plan…'}
          </Text>
        </View>
      ) : null}
      <FlatList
        onEndReached={mode === 'engineers' ? query.loadMore : undefined}
        onEndReachedThreshold={0.5}
        refreshing={mode === 'engineers' && query.isRefetching}
        onRefresh={mode === 'engineers' ? query.refetch : undefined}
        data={mode === 'engineers' ? engineers : []}
        keyExtractor={item => item.id}
        contentContainerStyle={[
          styles.list,
          {paddingBottom: (isTabScreen ? tabBarHeight : insets.bottom) + 24},
        ]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            <Animated.View entering={FadeInDown.duration(Motion.entrance).reduceMotion(ReduceMotion.System)} style={styles.findIntro}>
              <Pressable
                style={styles.searchAction}
                accessibilityRole="button"
                accessibilityLabel="Search professionals and services"
                onPress={() => navigation.navigate('Search')}>
                <Icon name={ICONS.search} size={20} color={Colors.slate500} />
                <Text style={styles.searchLabel}>
                  Search by skill
                </Text>
                <Icon
                  name={ICONS.chevronRight}
                  size={18}
                  color={Colors.navyMid}
                />
              </Pressable>
              <View style={styles.modeSwitch} accessibilityRole="tablist">
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{selected: mode === 'engineers'}}
                  onPress={() => setMode('engineers')}
                  style={[
                    styles.modeOption,
                    mode === 'engineers' && styles.modeOptionActive,
                  ]}>
                  <Icon
                    name={ICONS.engineers}
                    size={18}
                    color={mode === 'engineers' ? Colors.white : Colors.navyMid}
                  />
                  <Text
                    style={[
                      styles.modeLabel,
                      mode === 'engineers' && styles.modeLabelActive,
                    ]}>
                    Engineers
                  </Text>
                </Pressable>
                <View style={styles.modeDivider} />
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{selected: mode === 'services'}}
                  onPress={() => setMode('services')}
                  style={[
                    styles.modeOption,
                    mode === 'services' && styles.modeOptionActive,
                  ]}>
                  <Icon
                    name={ICONS.serviceHero}
                    size={18}
                    color={mode === 'services' ? Colors.white : Colors.navyMid}
                  />
                  <Text
                    style={[
                      styles.modeLabel,
                      mode === 'services' && styles.modeLabelActive,
                    ]}>
                    Services
                  </Text>
                </Pressable>
              </View>
            </Animated.View>
            {mode === 'engineers' ? (
              <>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}>
                  {ENGINEER_CATEGORIES.map(category => {
                    const selected = filter === category.filter;
                    return (
                      <Pressable
                        key={category.title}
                        accessibilityRole="button"
                        accessibilityLabel={`Browse ${category.title}`}
                        accessibilityState={{selected}}
                        style={[
                          styles.chip,
                          selected && styles.chipSelected,
                        ]}
                        onPress={() => setFilter(category.filter)}>
                        <Icon
                          name={category.icon}
                          size={15}
                          color={selected ? Colors.white : Colors.interactiveBlue}
                        />
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.chipLabel,
                            selected && styles.chipLabelSelected,
                          ]}>
                          {category.filter === 'All' ? 'All' : category.title}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <View style={styles.professionalHeadingRow}>
                  <Text style={styles.professionalHeading}>
                    Engineers in {cityName}
                  </Text>
                  <Text style={styles.resultCount}>
                    {engineers.length} found
                  </Text>
                </View>
                <View style={styles.filterControls}>
                  <Pressable style={styles.filterButton} accessibilityRole="button" accessibilityLabel={`Sort engineers, currently ${geoLoading ? 'locating you' : sort}`} onPress={() => setFilterSheet('sort')}>
                    <Text numberOfLines={1} style={styles.filterValue}>{geoLoading ? 'Locating…' : sort}</Text>
                    <Icon name={ICONS.chevronDown} size={16} color={Colors.navyDeep} />
                  </Pressable>
                  <Pressable style={styles.filterButton} accessibilityRole="button" accessibilityLabel={`Choose specialization, currently ${filter}`} onPress={() => setFilterSheet('specialization')}>
                    <Text numberOfLines={1} style={styles.filterValue}>{filter === 'All' ? 'All' : filter}</Text>
                    <Icon name={ICONS.chevronDown} size={16} color={Colors.navyDeep} />
                  </Pressable>
                </View>
                {query.isLoading ? (
                  <>
                    <EngineerCardSkeleton />
                    <EngineerCardSkeleton />
                  </>
                ) : null}
              </>
            ) : (
              <View style={styles.servicesSection}>
                <View style={styles.professionalHeadingRow}>
                  <View>
                    <Text style={styles.professionalHeading}>
                      Home services
                    </Text>
                    <Text style={styles.servicesHint}>
                      {city
                        ? `Help in ${cityName}. Tap the service you need.`
                        : 'Choose your city from Home, then tap the service you need.'}
                    </Text>
                  </View>
                </View>
                <View style={styles.serviceList}>
                  {(categories.data ?? []).map((service, index) => {
                    const iconography = iconographyForService(`${service.title} ${service.group}`);
                    return <Animated.View
                      key={service.id}
                      entering={FadeInDown.duration(Motion.entrance).delay(stagger(index)).reduceMotion(ReduceMotion.System)}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${service.title}`}
                      style={styles.serviceRow}
                      onPress={() =>
                        navigation.navigate('Services', {serviceId: service.id})
                      }>
                      <View style={styles.serviceIcon}>
                        <Icon
                          name={iconography.icon as IconName}
                          size={24}
                          color={iconography.color}
                        />
                      </View>
                      <View style={styles.serviceCopy}>
                        <Text style={styles.serviceGroup}>{service.group}</Text>
                        <Text style={styles.serviceTitle}>{service.title}</Text>
                        <Text
                          style={styles.serviceDescription}
                          numberOfLines={2}>
                          {service.description}
                        </Text>
                      </View>
                      <Icon
                        name={ICONS.chevronRight}
                        size={18}
                        color={Colors.slate400}
                      />
                    </Pressable>
                    </Animated.View>;
                  })}
                </View>
              </View>
            )}
          </>
        }
        ListEmptyComponent={
          mode === 'engineers' && !query.isLoading && query.isOffline ? (
            <ErrorState
              icon={ICONS.engineers}
              title="Engineers are unavailable"
              message="We could not load professionals from Nahtreek. Check your connection and try again."
              onAction={query.refetch}
            />
          ) : mode === 'engineers' && !query.isLoading ? (
            <EmptyState
              icon={sort === 'Saved' ? ICONS.heartOutline : ICONS.engineers}
              title={
                sort === 'Saved'
                  ? 'No saved engineers yet'
                  : 'No engineers found'
              }
              message={
                sort === 'Saved'
                  ? 'Tap the heart on any engineer to shortlist them here.'
                  : city
                  ? `No matching engineers are listed in ${cityName}. Try another specialization or search city.`
                  : 'Choose a city to find engineers near you, or clear the filters to browse all specializations.'
              }
              actionLabel={
                sort === 'Saved'
                  ? 'Browse Engineers'
                  : !city
                  ? 'Choose city'
                  : 'Clear Filter'
              }
              onAction={() => {
                if (sort === 'Saved') setSort('Top Rated');
                else if (!city) setCityPickerOpen(true);
                else setFilter('All');
              }}
            />
          ) : null
        }
        renderItem={({item}) => (
          <EngineerRow
            engineer={item}
            saved={savedProfessionalIds.includes(item.professionalProfileId)}
            onHeart={() => onHeart(item)}
            onOpen={() =>
              navigation.navigate('EngineerProfile', {engineerId: item.id, ...(planId ? {planId} : {})})
            }
            onConsult={() =>
              token ? setConsult(item) : navigation.navigate('Login')
            }
          />
        )}
      />

      <DistrictLocationPicker
        visible={cityPickerOpen}
        state={selectedState}
        district={city}
        onClose={() => setCityPickerOpen(false)}
        onSelect={(nextState, nextDistrict) => {
          if (!user) {
            setCity(nextDistrict, nextState);
            setCityPickerOpen(false);
            return;
          }
          updateProfile.mutate(
            {city: nextDistrict, state: nextState},
            {
              onSuccess: profile => {
                if (profile.userId !== useSessionStore.getState().user?.id) return;
                setCity(profile.city ?? nextDistrict, profile.state ?? nextState);
                setCityPickerOpen(false);
              },
              onError: error => toast(error instanceof Error ? error.message : 'Could not update your location. Please try again.', 'error'),
            },
          );
        }}
      />

      <BottomSheet
        visible={filterSheet !== null}
        title={filterSheet === 'sort' ? 'Sort engineers' : 'Choose specialization'}
        onClose={() => setFilterSheet(null)}>
        {(filterSheet === 'sort' ? SORTS : FILTERS).map(option => (
          <Pressable
            key={option}
            accessibilityRole="button"
            style={styles.filterOption}
            onPress={() => {
              if (filterSheet === 'sort') void pickSort(option);
              else setFilter(option);
              setFilterSheet(null);
            }}>
            <Text style={styles.filterOptionText}>{option}</Text>
            {(filterSheet === 'sort' ? sort : filter) === option ? (
              <Icon name={ICONS.check} size={20} color={ClientColors.accentIcon} />
            ) : null}
          </Pressable>
        ))}
      </BottomSheet>

      {consult && (
        <ConsultationSheet
          engineer={consult}
          onClose={() => setConsult(null)}
          onTrack={track}
          planPrefill={planSheetPrefill(planDraft)}
          onCreate={async payload => {
            if (planId) {
              return requestPlanQuotes(planId, {
                ...payload,
                engineerProfileId: consult.id,
              });
            }
            return createRequest.mutateAsync({
              ...payload,
              engineerProfileId: consult.id,
            });
          }}
        />
      )}
    </View>
  );
}

function EngineerRow({
  engineer,
  saved,
  onOpen,
  onConsult,
  onHeart,
}: {
  engineer: EngineerProfileDto;
  saved: boolean;
  onOpen: () => void;
  onConsult: () => void;
  onHeart: () => void;
}) {
  return (
    <Card style={styles.card} padded={false}>
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Open ${engineer.fullName}`}>
        <View style={styles.cardBody}>
          <View style={styles.cardHeader}>
            <Avatar
              name={engineer.fullName}
              size={40}
              uri={engineer.avatarUrl}
              source={engineer.avatarUrl ? undefined : portraitFor(engineer.id)}
            />
            <View style={styles.cardTitles}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>
                  {engineer.fullName}
                </Text>
                {engineer.verificationStatus === 'VERIFIED' ? (
                  <Icon name={ICONS.verified} size={15} color={Colors.teal} />
                ) : null}
                {engineer.isMember ? <MemberBadge /> : null}
              </View>
              <Text style={styles.degree} numberOfLines={1}>
                {engineer.title}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onHeart}
              style={styles.heart}
              accessibilityRole="button"
              accessibilityState={{selected: saved}}
              accessibilityLabel={
                saved ? 'Remove from saved' : 'Save engineer'
              }>
              <Icon
                name={saved ? ICONS.heart : ICONS.heartOutline}
                size={18}
                color={saved ? ClientColors.accentIcon : Colors.slate400}
              />
            </TouchableOpacity>
          </View>
          <View style={styles.metaRow}>
            {engineer.totalReviewsCount > 0 ? (
              <RatingStars rating={engineer.averageRating} count={engineer.totalReviewsCount} />
            ) : <Text style={styles.meta}>New profile</Text>}
            <Text style={styles.metaDot}>•</Text>
            <Text style={styles.meta}>{engineer.yearsOfExperience} yrs</Text>
            <Text style={styles.metaDot}>•</Text>
            <Icon name={ICONS.location} size={12} color={Colors.slate500} />
            <Text style={styles.meta}>
              {engineer.distanceKm == null
                ? 'Distance unavailable'
                : `${engineer.distanceKm} km`}
            </Text>
          </View>
          {engineer.rankFactors?.length ? (
            <Text style={styles.rankFactors} numberOfLines={1}>
              {engineer.rankFactors.join('  ·  ')}
            </Text>
          ) : null}
          <View style={styles.slotRow}>
            <Icon
              name={ICONS.clock}
              size={12}
              color={engineer.isAvailable ? Colors.success : Colors.slate400}
            />
            <Text
              numberOfLines={1}
              style={[
                styles.slotLabel,
                !engineer.isAvailable && styles.slotLabelIdle,
              ]}>
              {engineer.isAvailable
                ? engineer.nextSlot ? `Next opening ${engineer.nextSlot}` : 'Accepting requests'
                : 'Currently unavailable'}
            </Text>
          </View>
          {engineer.bio ? (
            <Text style={styles.bio} numberOfLines={1}>
              {engineer.bio}
            </Text>
          ) : null}
          <View style={styles.cardFooter}>
            <Text
              style={styles.fee}
              numberOfLines={1}
              accessibilityLabel={
                engineer.consultationFeePaisa == null
                  ? 'Consultation fee on request'
                  : `Consultation fee ${inr(engineer.consultationFeePaisa)}`
              }>
              {engineer.consultationFeePaisa == null
                ? 'Fee on request'
                : inr(engineer.consultationFeePaisa)}
              <Text style={styles.feeSuffix}> · Consultation</Text>
            </Text>
            <Button
              label="Request consultation"
              onPress={onConsult}
              style={styles.cta}
            />
          </View>
        </View>
      </TouchableOpacity>
    </Card>
  );
}

const styles = StyleSheet.create({
  findHeader: {paddingBottom: 20, paddingRight: Spacing.md},
  planBanner: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, marginHorizontal: Spacing.lg, marginTop: Spacing.sm},
  planBannerText: {...Typography.caption, color: ClientColors.accentText, fontWeight: '700', flex: 1},
  changeCityButton: {height: 44, minWidth: 116, paddingHorizontal: 12, borderRadius: 22, backgroundColor: ClientColors.white, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6},
  changeCityText: {fontSize: 12, fontWeight: '700', color: Colors.navyDeep},
  cityOption: {minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.slate200},
  cityOptionText: {...Typography.body, flex: 1, color: Colors.slate900},
  container: {
    flex: 1,
    backgroundColor: ClientColors.lightBackground,
  },
  filterControls: {flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm, marginBottom: Spacing.xs},
  filterButton: {flex: 1, minWidth: 0, minHeight: 48, paddingHorizontal: Spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 5, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.slate200, borderRadius: BorderRadius.md},
  filterValue: {...Typography.badge, fontSize: 12, fontWeight: '700', color: Colors.navyDeep, flex: 1},
  filterOption: {minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.slate200},
  filterOptionText: {...Typography.body, color: Colors.slate900},
  findIntro: {
    paddingTop: 4,
    backgroundColor: ClientColors.lightBackground,
  },
  modeSwitch: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
    marginTop: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.slate200,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.white,
  },
  modeOption: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    borderRadius: BorderRadius.md,
  },
  modeOptionActive: {backgroundColor: Colors.navyDeep},
  modeDivider: {
    width: 1,
    height: 24,
    backgroundColor: Colors.slate200,
    marginHorizontal: 3,
  },
  modeLabel: {...Typography.caption, fontWeight: '700', color: Colors.navyMid},
  modeLabelActive: {color: Colors.white},
  searchAction: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.slate200,
    backgroundColor: Colors.white,
  },
  searchLabel: {
    ...Typography.body,
    color: Colors.slate500,
    flex: 1,
  },
  chipRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingTop: Spacing.md,
    paddingBottom: 2,
  },
  chip: {
    minHeight: 40,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.slate200,
    backgroundColor: Colors.white,
  },
  chipSelected: {
    borderColor: Colors.navyDeep,
    backgroundColor: Colors.navyDeep,
  },
  chipLabel: {
    ...Typography.caption,
    fontWeight: '700',
    color: Colors.slate700,
  },
  chipLabelSelected: {
    color: Colors.white,
  },
  professionalHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: Spacing.md,
  },
  professionalHeading: {
    flexShrink: 1,
    ...Typography.h3,
    color: Colors.slate900,
  },
  resultCount: {
    flexShrink: 0,
    ...Typography.caption,
    color: Colors.slate500,
  },
  servicesSection: {marginTop: Spacing.lg},
  servicesHint: {...Typography.caption, color: Colors.slate500, marginTop: 3},
  serviceList: {gap: Spacing.sm, marginTop: Spacing.md},
  serviceRow: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.slate200,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.white,
  },
  serviceIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serviceCopy: {flex: 1},
  serviceGroup: {...Typography.badge, color: Colors.slate500},
  serviceTitle: {
    ...Typography.caption,
    fontWeight: '700',
    color: Colors.slate900,
    marginTop: 2,
  },
  serviceDescription: {
    ...Typography.badge,
    color: Colors.slate500,
    marginTop: 2,
  },
  listHeaderEnd: {
    marginBottom: Spacing.sm,
  },
  list: {
    padding: 20,
  },
  card: {
    borderRadius: 16,
    marginBottom: Spacing.md,
    overflow: 'hidden',
  },
  cardBody: {
    padding: 14,
    backgroundColor: Colors.surface,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  cardTitles: {
    flex: 1,
    paddingRight: 40,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  name: {
    ...Typography.h3,
    fontSize: 16,
    lineHeight: 21,
    color: Colors.slate900,
    flexShrink: 1,
  },
  degree: {
    ...Typography.caption,
    color: Colors.slate600,
    marginTop: 1,
  },
  heart: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    rowGap: 4,
    gap: Spacing.xs,
    marginTop: Spacing.md,
  },
  metaDot: {
    color: Colors.slate300,
  },
  meta: {
    ...Typography.caption,
    color: Colors.slate600,
  },
  rankFactors: {
    ...Typography.caption,
    color: ClientColors.accentText,
    fontWeight: '700',
    marginTop: 6,
  },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: Spacing.xs,
  },
  slotLabel: {
    ...Typography.badge,
    color: Colors.success,
  },
  slotLabelIdle: {
    color: Colors.slate400,
  },
  bio: {
    ...Typography.body,
    color: Colors.slate600,
    marginTop: Spacing.sm,
  },
  cardFooter: {
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.slate100,
  },
  fee: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
    color: Colors.navyDeep,
  },
  feeSuffix: {
    ...Typography.badge,
    fontWeight: '400',
    color: Colors.slate500,
  },
  cta: {
    minHeight: 44,
  },
});
