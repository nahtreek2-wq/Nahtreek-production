import React, {useEffect, useState} from 'react';
import {Linking, Pressable, StyleSheet, Text, View} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {ClientAvatar} from './ClientAvatar';
import {currentLocation} from '../services/location';
import {ProColors, ProRadius, ProSpacing, ProType} from '../theme/professionalTheme';

function haversineKm(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (toLat - fromLat) * rad;
  const dLng = (toLng - fromLng) * rad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(fromLat * rad) * Math.cos(toLat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

function formatDistance(km: number): string {
  if (!Number.isFinite(km) || km < 0) return '';
  if (km < 1) return `≈ ${Math.max(50, Math.round((km * 1000) / 50) * 50)} m away`;
  return km < 10 ? `≈ ${km.toFixed(1)} km away` : `≈ ${Math.round(km)} km away`;
}

/** Travel mode for the working pro: the client address stays one glance
 * away while travelling, with one-tap navigation and the in-app map. The
 * distance is a best-effort straight-line hint — navigation gives the road
 * route. Never blocks: a missing fix simply hides the distance line. */
export function TravelToJobCard({title, clientName, clientAvatarUrl, address, latitude, longitude, onMap}: {
  title: string;
  clientName?: string;
  clientAvatarUrl?: string;
  address: string;
  latitude?: number;
  longitude?: number;
  onMap: () => void;
}) {
  const [distance, setDistance] = useState('');
  const hasCoordinates =
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude);
  useEffect(() => {
    if (!hasCoordinates) return;
    let active = true;
    currentLocation()
      .then(fix => {
        if (active) setDistance(formatDistance(haversineKm(fix.latitude, fix.longitude, latitude!, longitude!)));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [hasCoordinates, latitude, longitude]);
  const destination = hasCoordinates ? `${latitude},${longitude}` : address;
  const navigate = () => {
    void Linking.openURL(
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`,
    ).catch(() => undefined);
  };
  return (
    <View style={styles.card} accessibilityLabel={`Travel to ${address}`}>
      <View style={styles.topRow}>
        <ClientAvatar name={clientName} avatarUrl={clientAvatarUrl} size={44} />
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>TRAVEL TO JOB</Text>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.client} numberOfLines={1}>
            {clientName || 'Customer'}
            {distance ? `  ·  ${distance}` : ''}
          </Text>
        </View>
      </View>
      <View style={styles.addressRow}>
        <MaterialCommunityIcons name="map-marker" size={20} color={ProColors.primary} />
        <Text style={styles.address} numberOfLines={2}>
          {address || 'Location not provided'}
        </Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Navigate to ${address}`}
          onPress={navigate}
          style={({pressed}) => [styles.navigate, pressed && styles.pressed]}>
          <MaterialCommunityIcons name="navigation" size={19} color={ProColors.onAccent} />
          <Text style={styles.navigateText}>Navigate</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View job on map"
          onPress={onMap}
          style={({pressed}) => [styles.mapButton, pressed && styles.pressed]}>
          <MaterialCommunityIcons name="map-outline" size={19} color={ProColors.primary} />
          <Text style={styles.mapText}>View map</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {backgroundColor: ProColors.surface, borderRadius: ProRadius.card, borderWidth: 1,
    borderColor: ProColors.border, padding: ProSpacing.lg, gap: ProSpacing.md, marginBottom: ProSpacing.lg},
  topRow: {flexDirection: 'row', alignItems: 'center', gap: ProSpacing.md},
  copy: {flex: 1, minWidth: 0},
  eyebrow: {...ProType.eyebrow, color: ProColors.primary},
  title: {fontSize: 16, lineHeight: 22, fontWeight: '700', color: ProColors.text, marginTop: 2},
  client: {...ProType.meta, color: ProColors.secondary, marginTop: 2},
  addressRow: {flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: ProColors.blueSoft, borderRadius: ProRadius.input, padding: ProSpacing.md},
  address: {flex: 1, fontSize: 15, lineHeight: 22, fontWeight: '600', color: ProColors.text},
  actions: {flexDirection: 'row', gap: ProSpacing.sm},
  navigate: {flex: 1, minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: ProRadius.input, backgroundColor: ProColors.accent},
  navigateText: {...ProType.action, color: ProColors.onAccent},
  mapButton: {flex: 1, minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: ProRadius.input, borderWidth: 1, borderColor: ProColors.border,
    backgroundColor: ProColors.surface},
  mapText: {...ProType.action, color: ProColors.primary},
  pressed: {opacity: 0.82},
});
