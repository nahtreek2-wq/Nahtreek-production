import {ScreenHeader} from '../components/ScreenHeader';
import {ProLoader} from '../components/ProLoader';
import React, {useEffect, useState} from 'react';
import {
  Alert,
  Image,
  Linking,
  NativeModules,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {WebView} from 'react-native-webview';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {RequestsStackParamList} from '../navigation/types';
import {Colors} from '@nahtreek/design-system';
import {ProColors} from '../theme/professionalTheme';

type Route = RouteProp<RequestsStackParamList, 'MapPreview'>;
const mapBridge = NativeModules.NahtreekRuntimeConfig as {
  getStaticMapUrl?: (latitude: number, longitude: number) => Promise<string>;
  getMapHtml?: (latitude: number, longitude: number) => Promise<string>;
} | null;
// Interactive maps render where the native HTML supplier exists (Android
// builds with the map module); everywhere else the screen stays on the
// static image plus Google Maps directions.
const canInteract = typeof mapBridge?.getMapHtml === 'function';

export function MapPreviewScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RequestsStackParamList>>();
  const {params} = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const hasCoordinates =
    typeof params.latitude === 'number' &&
    typeof params.longitude === 'number' &&
    Number.isFinite(params.latitude) &&
    Number.isFinite(params.longitude) &&
    Math.abs(params.latitude) <= 90 &&
    Math.abs(params.longitude) <= 180;
  const destination = hasCoordinates
    ? `${params.latitude},${params.longitude}`
    : params.address;
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [mapHtml, setMapHtml] = useState<string | null>(null);
  const [mapError, setMapError] = useState('');
  const [mapLoading, setMapLoading] = useState(true);
  const [interactive, setInteractive] = useState(canInteract);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    // Android sometimes never calls back for a failed map image — without a
    // watchdog the spinner runs forever and the map "never opens".
    const watchdog = setTimeout(() => {
      if (active) {setMapLoading(false); setMapError(known => known || 'Map is taking too long. Check your connection and retry.');}
    }, 15000);
    setMapUrl(null);
    setMapHtml(null);
    setMapError('');
    setMapLoading(true);
    setInteractive(canInteract);
    if (
      !hasCoordinates ||
      Platform.OS !== 'android' ||
      !mapBridge?.getStaticMapUrl
    ) {
      clearTimeout(watchdog);
      setMapLoading(false);
      if (hasCoordinates && Platform.OS === 'android')
        setMapError(
          'Map view is unavailable in this build. Use directions below.',
        );
      return () => {
        active = false;
      };
    }
    if (canInteract && mapBridge.getMapHtml) {
      mapBridge
        .getMapHtml(params.latitude!, params.longitude!)
        .then(html => {
          if (active) {clearTimeout(watchdog); setMapHtml(html); setMapLoading(false);}
        })
        .catch(() => {
          // Interactive HTML failed: fall back to the static image below.
          if (active) setInteractive(false);
        });
    }
    mapBridge
      .getStaticMapUrl(params.latitude!, params.longitude!)
      .then(url => {
        if (active) {clearTimeout(watchdog); setMapUrl(url);}
      })
      .catch(error => {
        if (active) {
          clearTimeout(watchdog);
          setMapLoading(false);
          setMapError(
            error instanceof Error ? error.message : 'Map is unavailable.',
          );
        }
      });
    return () => {
      active = false;
      clearTimeout(watchdog);
    };
  }, [hasCoordinates, params.latitude, params.longitude, attempt]);

  const openDirections = () => {
    void Linking.openURL(
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
        destination,
      )}`,
    ).catch(() =>
      Alert.alert(
        'Directions unavailable',
        'Please try again when you are connected.',
      ),
    );
  };

  return (
    <View style={[styles.root, {paddingBottom: insets.bottom}]}>
      <ScreenHeader
        title="Job location"
        subtitle={params.address}
        onBack={() => navigation.goBack()}
      />
      <View style={styles.map}>
        {interactive && mapHtml ? (
          <WebView
            accessibilityLabel="Interactive job map"
            source={{html: mapHtml, baseUrl: 'https://nahtreek.local/'}}
            style={styles.mapImage}
            onShouldStartLoadWithRequest={() => false}
          />
        ) : mapUrl && !mapError ? (
          <>
            <Image
              source={{uri: mapUrl}}
              style={styles.mapImage}
              resizeMode="cover"
              onLoad={() => setMapLoading(false)}
              onError={() => {
                setMapLoading(false);
                setMapError('Map image could not load. Use directions below.');
              }}
            />
            {!mapLoading ? (
              <View style={styles.pin} accessibilityLabel="Pinned location" />
            ) : null}
          </>
        ) : null}
        {mapLoading && !mapError ? (
          <ProLoader size={52} label="Loading map…" />
        ) : null}
        {(!interactive || !hasCoordinates) &&
        (mapError || !hasCoordinates || Platform.OS !== 'android') ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>
              {mapError ||
                (!hasCoordinates
                  ? 'A map pin is not available for this address yet.'
                  : 'In-app map is currently available on Android.')}
            </Text>
            {mapError && hasCoordinates ? <Pressable accessibilityRole="button" accessibilityLabel="Retry loading the map"
              onPress={() => setAttempt(value => value + 1)} style={styles.mapMode}>
              <Text style={styles.mapModeText}>Retry map</Text>
            </Pressable> : null}
          </View>
        ) : null}
      </View>
      <View style={styles.footer}>
        {params.title || params.clientName ? (
          <View style={styles.jobCard}>
            {params.title ? (
              <Text style={styles.jobTitle} numberOfLines={1}>
                {params.title}
              </Text>
            ) : null}
            {params.clientName ? (
              <Text style={styles.jobClient} numberOfLines={1}>
                {params.clientName}
              </Text>
            ) : null}
            <Text style={styles.jobAddress} numberOfLines={2}>
              {params.address}
            </Text>
          </View>
        ) : null}
        {hasCoordinates && canInteract ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setInteractive(value => !value)}
            style={styles.mapMode}>
            <Text style={styles.mapModeText}>
              {interactive ? 'Show static map' : 'Explore interactive map'}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={openDirections}
          style={styles.action}>
          <Text style={styles.actionText}>Get directions ↗</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: Colors.offWhite},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
    backgroundColor: Colors.navyDeep,
  },
  back: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: '#111F35',
  },
  backText: {fontSize: 32, lineHeight: 38, color: ProColors.surface},
  heading: {flex: 1},
  logoFrame: {width: 36, height: 36, overflow: 'hidden', borderRadius: 9},
  logo: {width: 48, height: 48, marginLeft: -6, marginTop: -6},
  title: {fontSize: 20, lineHeight: 28, fontWeight: '700', color: ProColors.surface},
  address: {fontSize: 13, lineHeight: 19, color: '#D6E0E9', marginTop: 2},
  map: {
    flex: 1,
    backgroundColor: Colors.offWhite,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  mapImage: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0},
  pin: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 4,
    borderColor: Colors.navyDeep,
    backgroundColor: Colors.amber,
  },
  emptyWrap: {gap: 12, alignItems: 'center', paddingHorizontal: 24},
  emptyText: {
    fontSize: 16,
    lineHeight: 24,
    color: Colors.slate600,
    textAlign: 'center',
  },
  footer: {padding: 20, backgroundColor: ProColors.surface, gap: 10},
  jobCard: {gap: 2, borderRadius: 14, borderWidth: 1, borderColor: Colors.slate200,
    backgroundColor: Colors.offWhite, paddingHorizontal: 14, paddingVertical: 12},
  jobTitle: {fontSize: 16, lineHeight: 22, fontWeight: '700', color: Colors.slate900},
  jobClient: {fontSize: 13, lineHeight: 18, fontWeight: '600', color: Colors.slate600},
  jobAddress: {fontSize: 13, lineHeight: 19, color: Colors.slate600, marginTop: 2},
  mapMode: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.slate200,
    backgroundColor: Colors.white,
  },
  mapModeText: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    fontWeight: '700',
    color: Colors.navyDeep,
  },
  action: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: ProColors.accent,
  },
  actionText: {fontSize: 16, fontWeight: '800', color: ProColors.onAccent},
});
