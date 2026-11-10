import React, {useState} from 'react';
import {Animated as NativeAnimated, FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import Animated, {FadeInDown, ReduceMotion} from 'react-native-reanimated';
import {Colors, IndiaLocale} from '@nahtreek/design-system';
import {ClientColors} from '../design-system/tokens';
import {useNavigation, useRoute, RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {AppHeader, Avatar, BottomSheet, Button, Icon, ICONS, MemberBadge, RatingStars} from '../components/ui';
import {
  useServiceProviders,
  type ServiceProvider,
} from '../services/platformQueries';
import {useCity} from '../stores/city';
import {useSessionStore} from '../stores/session';
import {useFavoritesList, useToggleFavorite, useUpdateClientProfile} from '../services/queries';
import {useToast} from '../stores/toast';
import {DistrictLocationPicker} from '../components/DistrictLocationPicker';
import {isApiConfigured} from '../services/config';
import type {RootStackParamList} from '../navigation/types';
import {platformStyles as s} from './PlatformHistoryScreen';
import {ProviderCardSkeleton} from '../components/SkeletonLoader';
import {useScrollMotion, ScrollMotionBar} from '../components/ScrollMotionBar';

// useScrollMotion emits React Native Animated events with useNativeDriver. The
// Reanimated FlatList wrapper is not compatible with that event shape, so use
// the matching native Animated wrapper for this list.
const NativeAnimatedFlatList = NativeAnimated.createAnimatedComponent(FlatList) as unknown as typeof FlatList;

export function ServiceProvidersScreen() {
  const scrollMotion = useScrollMotion();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'ServiceProviders'>>();
  const city = useCity(state => state.city);
  const selectedState = useCity(state => state.state);
  const setCity = useCity(state => state.setCity);
  const token = useSessionStore(state => state.accessToken);
  const user = useSessionStore(state => state.user);
  const isGuest = useSessionStore(state => state.isGuest);
  const updateProfile = useUpdateClientProfile();
  const toast = useToast();
  const providers = useServiceProviders(city, route.params.serviceId, selectedState);
  const favoritesQ = useFavoritesList();
  const toggleFavorite = useToggleFavorite();
  const savedIds = new Set((favoritesQ.data ?? []).map(f => f.professionalId));
  const onHeart = (item: ServiceProvider) => {
    if (!token) { nav.navigate('Login'); return; }
    if (toggleFavorite.isPending) return;
    const adding = !savedIds.has(item.id);
    toggleFavorite.mutate({professionalId: item.id, isAdding: adding}, {
      onSuccess: () => toast(adding ? 'Saved to your list' : 'Removed from saved', 'success'),
      onError: () => toast('Could not update saved professionals. Please try again.', 'error'),
    });
  };
  const [selected, setSelected] = useState<ServiceProvider | null>(null);
  const [nearbyOpen, setNearbyOpen] = useState(false);
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
  const bookingServiceAvailable = isApiConfigured && !providers.isError;
  const chooseCity = (nextCity: string, nextState: string) => {
    if (!user || isGuest) {
      setCity(nextCity, nextState);
      setCityPickerOpen(false);
      return;
    }
    updateProfile.mutate(
      {city: nextCity, state: nextState},
      {
        onSuccess: profile => {
          if (profile.userId !== useSessionStore.getState().user?.id) return;
          setCity(profile.city ?? nextCity, profile.state ?? nextState);
          setCityPickerOpen(false);
        },
        onError: error => toast(error instanceof Error ? error.message : 'Could not update your city. Please try again.', 'error'),
      },
    );
  };
  return (
    <View style={[s.root, styles.root]}>
      <AppHeader
        title={route.params.title}
        subtitle={city || 'Choose your city'}
        onBack={() => nav.goBack()}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Change service city, current ${city || 'not selected'}`}
            onPress={() => setCityPickerOpen(true)}
            style={styles.changeCityButton}>
            <Icon name={ICONS.location} size={15} color={Colors.navyDeep} />
            <Text style={styles.changeCityText}>Change</Text>
          </Pressable>
        }
      />
      <ScrollMotionBar offset={scrollMotion.offset} reducedMotion={scrollMotion.reducedMotion} />
      {route.params.fromAiPlan ? (
        <View style={styles.planBanner}>
          <Text style={styles.planBannerText}>Booked from your AI plan — description prefilled. Plus priority: fast accept, and lateness penalties protect this job.</Text>
        </View>
      ) : null}
      <NativeAnimatedFlatList
        ListHeaderComponent={
          <Pressable
            style={[styles.addressLink, !bookingServiceAvailable && styles.disabledAction]}
            accessibilityRole="button"
            accessibilityState={{disabled: !bookingServiceAvailable}}
            accessibilityLabel={bookingServiceAvailable ? 'Book at a new or current address' : 'Booking unavailable while the service is disconnected'}
            disabled={!bookingServiceAvailable}
            onPress={()=>token ? setNearbyOpen(true) : nav.navigate('Login')}>
            <View style={styles.locationIcon}><Icon name={ICONS.location} size={22} color={ClientColors.accentIcon} /></View>
            <View style={styles.copy}>
              <Text style={styles.addressTitle}>Where do you need help?</Text>
              <Text style={s.text}>Book at a new or current address</Text>
            </View>
            <Icon name={ICONS.chevronRight} size={20} color={Colors.navyDeep} />
          </Pressable>
        }
        contentContainerStyle={[s.body, styles.body]}
        data={providers.data?.pages.flatMap(page => page.data) ?? []}
        keyExtractor={item => item.id}
        refreshing={providers.isRefetching}
        onRefresh={() => void providers.refetch()}
        onScroll={scrollMotion.onScroll}
        scrollEventThrottle={16}
        ListEmptyComponent={
          providers.isPending && isApiConfigured ? (
            <View>
              <ProviderCardSkeleton />
              <ProviderCardSkeleton />
            </View>
          ) : <View style={[s.card, styles.providerCard]}>
            <Text style={s.title}>
              {!isApiConfigured ? 'Booking service is not connected' : !city ? 'Choose your city first' : providers.isPending
                ? 'Finding help near you…'
                : providers.isError
                ? 'Could not connect to NAHTREEK'
              : 'No verified providers for this service in this city'}
            </Text>
            <Text style={s.text}>
              {!isApiConfigured
                ? 'This app build has no service-server address, so professional listings and bookings are unavailable.'
                : providers.isError
                ? 'Check your connection and try again. Booking options will appear when the service reconnects.'
                : 'Providers appear here after their accounts are verified and they offer this service. Try another city or check back later.'}
            </Text>
            <Button
              label={!isApiConfigured ? 'Go to Home' : providers.isError ? 'Try again' : 'Choose another city'}
              variant="secondary"
              onPress={() => !isApiConfigured ? nav.navigate('MainTabs', {screen: 'Home'}) : providers.isError ? void providers.refetch() : setCityPickerOpen(true)}
            />
          </View>
        }
        ListFooterComponent={
          providers.hasNextPage ? (
            <Button
              label="Show more"
              loading={providers.isFetchingNextPage}
              onPress={() => void providers.fetchNextPage()}
            />
          ) : null
        }
        renderItem={({item, index}) => (
          <Animated.View entering={FadeInDown.duration(280).delay(Math.min(index * 45, 225)).reduceMotion(ReduceMotion.System)} style={[s.card, styles.providerCard]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View ${item.fullName} profile`}
              onPress={() => nav.navigate('ProviderProfile', {professionalProfileId: item.id})}
              style={({pressed}) => [s.row, pressed && styles.cardPressed]}>
              <Avatar name={item.fullName} uri={item.avatarUrl} />
              <View style={{flex: 1}}>
                <View style={styles.nameRow}>
                  <Text style={[s.title, styles.name]}>{item.fullName}</Text>
                  {item.memberPriority ? <MemberBadge /> : null}
                </View>
                <Text style={s.text}>
                  {item.title} · {item.baseCity}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={savedIds.has(item.id) ? `Remove ${item.fullName} from saved` : `Save ${item.fullName}`}
                hitSlop={8}
                onPress={() => onHeart(item)}
                style={styles.heart}>
                <Icon name={savedIds.has(item.id) ? ICONS.heart : ICONS.heartOutline} size={22} color={Colors.navyMid} />
              </Pressable>
              <Icon name={ICONS.chevronRight} size={22} color={Colors.navyMid} />
            </Pressable>
            <Text style={s.text}>{item.yearsOfExperience} years of experience · Verified profile</Text>
            <View style={styles.availability}>
              <View style={[styles.availabilityDot, item.isAvailable ? styles.availabilityDotOn : styles.availabilityDotOff]} />
              <Text style={[styles.availabilityText, !item.isAvailable && styles.availabilityTextOff]}>
                {item.isAvailable ? 'Accepting requests' : 'Currently unavailable'}
              </Text>
            </View>
            {item.totalReviewsCount > 0 ? (
              <RatingStars rating={item.averageRating} count={item.totalReviewsCount} />
            ) : <Text style={s.text}>New profile · No reviews yet</Text>}
            <View style={styles.pricePanel}>
              <Text style={styles.price}>{item.startingPrice != null ? `From ${IndiaLocale.formatCurrency(item.startingPrice)}` : 'Ask for a quote'}</Text>
              {item.startingPrice != null ? <Text style={s.text}>Final cost confirmed before work</Text> : null}
            </View>
            <Pressable
              style={styles.mapLink}
              accessibilityRole="button"
              onPress={() => nav.navigate('MapPreview', {
                latitude: item.baseLatitude,
                longitude: item.baseLongitude,
                address: `${item.fullName} · ${item.baseCity}`,
              })}>
              <Icon name={ICONS.location} size={18} color="#2563EB" />
              <Text style={styles.mapLabel}>View provider area</Text>
              <Icon name={ICONS.chevronRight} size={18} color={Colors.navyDeep} />
            </Pressable>
            <Button
              label={
                item.isAvailable
                  ? 'Request this professional'
                  : 'Currently unavailable'
              }
              disabled={!item.isAvailable}
              onPress={() => {
                if (!token) {
                  nav.navigate('Login');
                  return;
                }
                setSelected(item);
              }}
            />
          </Animated.View>
        )}
      />
      <DistrictLocationPicker
        visible={cityPickerOpen}
        state={selectedState}
        district={city}
        onClose={() => setCityPickerOpen(false)}
        onSelect={(nextState, nextDistrict) => chooseCity(nextDistrict, nextState)}
      />
      <BottomSheet
        visible={Boolean(selected) || nearbyOpen}
        onClose={() => {
          setSelected(null); setNearbyOpen(false);
        }}
        title="Tell us about the work"
        subtitle={`Requesting ${selected?.fullName ?? 'a professional'}`}>
        {selected || nearbyOpen ? <ServiceBookingForm serviceId={route.params.serviceId} preferred={selected ?? undefined} onBooked={id => {setSelected(null);setNearbyOpen(false);nav.navigate('ServiceRequestDetail', {requestId:id, submitted:true});}} /> : null}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {backgroundColor: '#F3F5F8'},
  planBanner: {marginHorizontal: 20, marginTop: 12, backgroundColor: ClientColors.accentSoft, borderRadius: 12, padding: 12},
  planBannerText: {fontSize: 14, lineHeight: 20, fontWeight: '600', color: ClientColors.accentText},
  body: {padding: 20, gap: 16},
  providerCard: {padding: 20, borderRadius: 16, borderWidth: 1, borderColor: '#E1E6ED'},
  cardPressed: {opacity: 0.85},
  nameRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  name: {flexShrink: 1},
  heart: {padding: 6, marginRight: 2},
  addressLink: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, marginBottom: 8, minHeight: 72},
  disabledAction: {opacity: 0.55},
  locationIcon: {width: 48, height: 48, alignItems: 'center', justifyContent: 'center'},
  copy: {flex: 1},
  availability: {flexDirection: 'row', alignItems: 'center', gap: 7},
  availabilityDot: {width: 8, height: 8, borderRadius: 4},
  availabilityDotOn: {backgroundColor: '#166534'},
  availabilityDotOff: {backgroundColor: '#667085'},
  availabilityText: {fontSize: 13, lineHeight: 18, color: '#166534', fontWeight: '600'},
  availabilityTextOff: {color: '#667085'},
  addressTitle: {fontSize: 18, lineHeight: 24, color: '#111F35', fontWeight: '700'},
  pricePanel: {backgroundColor: '#F3F5F8', borderRadius: 12, padding: 16, gap: 4},
  price: {fontSize: 20, lineHeight: 27, fontWeight: '700', color: '#111F35'},
  mapLink: {minHeight: 48, flexDirection: 'row', gap: 8, alignItems: 'center'},
  mapLabel: {flex: 1, fontSize: 15, lineHeight: 22, fontWeight: '600', color: '#111F35'},
  changeCityButton: {minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, borderRadius: 14, backgroundColor: ClientColors.accentSoft},
  changeCityText: {fontSize: 13, fontWeight: '700', color: Colors.navyDeep},
});
import {ServiceBookingForm} from '../components/ServiceBookingForm';
