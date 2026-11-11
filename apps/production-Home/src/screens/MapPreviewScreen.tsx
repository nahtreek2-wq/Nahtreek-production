import React, {useEffect, useState} from 'react';
import {ActivityIndicator, Alert, Image, Linking, NativeModules, Pressable, requireNativeComponent, StyleSheet, Text, View, type StyleProp, type ViewStyle} from 'react-native';
import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useQuery} from '@tanstack/react-query';
import type {RootStackParamList} from '../navigation/types';
import {Colors} from '@nahtreek/design-system';
import {ClientColors} from '../design-system/tokens';
import {Icon, ICONS} from '../components/ui';
import {headerStyles} from '../../../../packages/mobile-ui/headerStyles';
import {api} from '../services/apiClient';

type Route = RouteProp<RootStackParamList, 'MapPreview'>;
const mapBridge = NativeModules.NahtreekRuntimeConfig as {getStaticMapUrl?: (latitude: number, longitude: number) => Promise<string>};
// The interactive view exists only where the native manager is linked —
// require it lazily so a missing view degrades to the static map instead of
// crashing the screen at import.
let GeoapifyMapView: React.ComponentType<{latitude: number; longitude: number; style: StyleProp<ViewStyle>}> | null = null;
try {
  GeoapifyMapView = requireNativeComponent<{latitude: number; longitude: number; style: StyleProp<ViewStyle>}>('GeoapifyMapView');
} catch {
  GeoapifyMapView = null;
}

type JourneyTracking = {latitude: number; longitude: number; updatedAt: string; stale: boolean};
type JourneyView = {stage: string; tracking?: JourneyTracking | null};
const CLOSED_STAGES = ['COMPLETED', 'CANCELLED', 'DECLINED', 'EXPIRED'];
const STAGE_LABELS: Record<string, string> = {
  PENDING: 'Waiting for acceptance',
  ACCEPTED: 'Visit accepted',
  EN_ROUTE: 'Professional is on the way',
  ARRIVED: 'Professional has arrived',
  IN_PROGRESS: 'Work in progress',
  AWAITING_CONFIRMATION: 'Please confirm the completed work',
  COMPLETED: 'Service completed',
  CANCELLED: 'Booking cancelled',
  DECLINED: 'Professional declined',
  EXPIRED: 'Request expired',
  DISPUTED: 'Issue reported — not completed',
};

function agoLabel(updatedAt: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(updatedAt)) / 1000));
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return minutes === 1 ? '1 min ago' : `${minutes} min ago`;
}

export function MapPreviewScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {params} = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const validCoords = (latitude?: number, longitude?: number) =>
    typeof latitude === 'number' && typeof longitude === 'number'
    && Number.isFinite(latitude) && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
  const hasCoordinates = validCoords(params.latitude, params.longitude);
  const destination = hasCoordinates ? `${params.latitude},${params.longitude}` : params.address;
  // Live mode (service bookings only): follow the professional while they
  // travel, Swiggy-style — the map recenters on their latest fix and the
  // banner names the stage and freshness. Closed bookings and plain pins
  // keep the static destination map below.
  const journey = useQuery({
    queryKey: ['service-journey', params.requestId],
    queryFn: () => api.get<JourneyView>(`/service-workflow/${params.requestId}`),
    enabled: Boolean(params.requestId),
    retry: 1,
    refetchInterval: query => {
      if (query.state.error) return false;
      const stage = query.state.data?.stage;
      return !stage || !CLOSED_STAGES.includes(stage) ? 5000 : false;
    },
    refetchIntervalInBackground: false,
  });
  const tracking = journey.data?.tracking ?? null;
  const journeyOpen = !journey.data || !CLOSED_STAGES.includes(journey.data.stage);
  const liveTracking = tracking && journeyOpen && validCoords(tracking.latitude, tracking.longitude) ? tracking : null;
  const centerLatitude = liveTracking ? liveTracking.latitude : params.latitude;
  const centerLongitude = liveTracking ? liveTracking.longitude : params.longitude;
  const centerHasCoordinates = validCoords(centerLatitude, centerLongitude);
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [mapError, setMapError] = useState('');
  const [mapLoading, setMapLoading] = useState(true);
  const [interactive, setInteractive] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    // Android sometimes never calls back for a failed map image — without a
    // watchdog the spinner runs forever and the map "never opens".
    const watchdog = setTimeout(() => {
      if (active) {setMapLoading(false); setMapError(mapError => mapError || 'Map is taking too long. Check your connection and retry.');}
    }, 15000);
    setMapUrl(null);
    setMapError('');
    setMapLoading(true);
    setInteractive(false);
    if (!centerHasCoordinates || !mapBridge?.getStaticMapUrl) {
      clearTimeout(watchdog);
      setMapLoading(false);
      if (centerHasCoordinates) setMapError('Map view is unavailable in this build. Use directions below.');
      return () => {active = false;};
    }
    mapBridge.getStaticMapUrl(centerLatitude!, centerLongitude!)
      .then(url => {if (active) {clearTimeout(watchdog); setMapUrl(url);}})
      .catch(error => {if (active) {clearTimeout(watchdog); setMapLoading(false); setMapError(error instanceof Error ? error.message : 'Map is unavailable.');}});
    return () => {active = false; clearTimeout(watchdog);};
  }, [centerHasCoordinates, centerLatitude, centerLongitude, attempt]);

  const openDirections = () => {
    void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`)
      .catch(() => Alert.alert('Directions unavailable', 'Please try again when you are connected.'));
  };
  const retry = () => {
    setAttempt(value => value + 1);
    if (params.requestId) void journey.refetch();
  };
  const stageLabel = journey.data ? STAGE_LABELS[journey.data.stage] ?? journey.data.stage : '';

  return (
    <View style={[styles.root, {paddingTop: insets.top, paddingBottom: insets.bottom}]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()} style={({pressed}) => [headerStyles.navigation, pressed && styles.backPressed]}>
          <Icon name={ICONS.back} size={24} color={Colors.white} />
        </Pressable>
        <View style={styles.heading}>
          <Text style={styles.title}>Location</Text>
          <Text numberOfLines={2} style={styles.address}>{params.address}</Text>
        </View>
        <View style={styles.logoFrame}>
          <Image source={require('../assets/nahtreek_home_mark.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="NAHTREEK logo" />
        </View>
      </View>
      {params.requestId && !journey.isError && journey.data ? (
        <View style={styles.liveBar}>
          <View style={[styles.liveDot, liveTracking && !liveTracking.stale ? styles.liveDotOn : styles.liveDotOff]} />
          <View style={styles.liveCopy}>
            {liveTracking ? (
              <>
                <Text style={styles.liveTitle}>{stageLabel}{liveTracking.stale ? '' : ` · updated ${agoLabel(liveTracking.updatedAt)}`}</Text>
                {liveTracking.stale ? (
                  <Text style={styles.liveStale}>Location is stale — the professional may have lost signal. Showing the last known position.</Text>
                ) : (
                  <Text style={styles.liveSubtitle}>Live professional location — the map follows them.</Text>
                )}
              </>
            ) : journeyOpen ? (
              <>
                <Text style={styles.liveTitle}>{stageLabel || 'Live tracking'}</Text>
                <Text style={styles.liveSubtitle}>Live tracking starts when the professional heads your way.</Text>
              </>
            ) : null}
          </View>
        </View>
      ) : null}
      <View style={styles.map}>
        {interactive && centerHasCoordinates && GeoapifyMapView ? (
          <GeoapifyMapView latitude={centerLatitude!} longitude={centerLongitude!} style={styles.mapImage} />
        ) : mapUrl && !mapError ? <><Image source={{uri: mapUrl}} style={styles.mapImage} resizeMode="cover"
          onLoad={() => setMapLoading(false)} onError={() => {setMapLoading(false); setMapError('Map image could not load. Use directions below.');}} />
          {!mapLoading ? <View style={[styles.pin, liveTracking && styles.livePin]} accessibilityLabel={liveTracking ? 'Professional live location' : 'Pinned location'} /> : null}</> : null}
        {mapLoading && !mapError && !interactive ? <ActivityIndicator size="large" color={ClientColors.accentIcon} /> : null}
        {!interactive && (mapError || !centerHasCoordinates) ? <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>
            {mapError || 'A map pin is not available for this address yet.'}
          </Text>
          {mapError && centerHasCoordinates ? <Pressable accessibilityRole="button" accessibilityLabel="Retry loading the map"
            onPress={retry} style={styles.mapMode}>
            <Text style={styles.mapModeText}>Retry map</Text>
          </Pressable> : null}
        </View> : null}
      </View>
      <View style={styles.footer}>
        {liveTracking ? (
          <Text style={styles.liveFooter} numberOfLines={2}>Heading to {params.address}</Text>
        ) : null}
        {centerHasCoordinates && GeoapifyMapView ? (
          <Pressable accessibilityRole="button" onPress={() => setInteractive(value => !value)} style={styles.mapMode}>
            <Text style={styles.mapModeText}>{interactive ? 'Show map' : 'Explore interactive map'}</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" onPress={openDirections} style={styles.action}>
          <Text style={styles.actionText}>Get directions ↗</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: Colors.navyDeep},
  header: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12, backgroundColor: Colors.navyDeep},
  backPressed: {opacity: 0.75, transform: [{scale: 0.94}]},
  heading: {flex: 1},
  logoFrame: {width: 36, height: 36, overflow: 'hidden', borderRadius: 9},
  logo: {width: 48, height: 48, marginLeft: -6, marginTop: -6},
  title: {fontSize: 20, fontWeight: '800', color: '#FFFFFF'},
  address: {fontSize: 13, lineHeight: 19, color: '#D6E0E9', marginTop: 2},
  liveBar: {flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: Colors.white, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.slate100},
  liveDot: {width: 10, height: 10, borderRadius: 5, marginTop: 5},
  liveDotOn: {backgroundColor: Colors.success},
  liveDotOff: {backgroundColor: Colors.slate300},
  liveCopy: {flex: 1, gap: 2},
  liveTitle: {fontSize: 14, lineHeight: 19, fontWeight: '700', color: Colors.navyDeep},
  liveSubtitle: {fontSize: 13, lineHeight: 18, color: Colors.slate500},
  liveStale: {fontSize: 13, lineHeight: 18, color: Colors.warning, fontWeight: '600'},
  liveFooter: {fontSize: 13, lineHeight: 18, color: Colors.slate600},
  map: {flex: 1, backgroundColor: Colors.offWhite, alignItems: 'center', justifyContent: 'center', padding: 20},
  mapImage: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0},
  pin: {width: 24, height: 24, borderRadius: 12, borderWidth: 4, borderColor: Colors.navyDeep, backgroundColor: ClientColors.accent},
  livePin: {borderColor: Colors.success},
  emptyText: {fontSize: 16, color: '#516376', textAlign: 'center'},
  emptyWrap: {gap: 12, alignItems: 'center', paddingHorizontal: 24},
  footer: {padding: 16, backgroundColor: '#FFFFFF', gap: 10},
  mapMode: {minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 15, borderWidth: 1, borderColor: Colors.slate200, backgroundColor: Colors.white},
  mapModeText: {fontSize: 15, fontWeight: '700', color: Colors.navyDeep},
  action: {minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: ClientColors.accent},
  actionText: {fontSize: 16, fontWeight: '800', color: ClientColors.onAccent},
});
