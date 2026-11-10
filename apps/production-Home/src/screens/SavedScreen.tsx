import React from 'react';
import {FlatList, StyleSheet, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Colors, IndiaLocale, Spacing} from '@nahtreek/design-system';
import {AppHeader, EmptyState, OfflineBanner} from '../components/ui';
import {ProfessionalCard} from '../components/shared/ProfessionalCard';
import {useFavoritesList} from '../services/queries';
import type {FavoriteDto} from '@nahtreek/types';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function priceFor(item: FavoriteDto): string {
  const pro = item.professional;
  if (!pro) return '';
  if (pro.engineerProfile) {
    return pro.engineerProfile.consultationFee == null
      ? 'Fee on request'
      : IndiaLocale.formatCurrency(pro.engineerProfile.consultationFee);
  }
  return pro.startingPrice == null
    ? 'Price on request'
    : `From ${IndiaLocale.formatCurrency(pro.startingPrice)}`;
}

function subFor(item: FavoriteDto): string {
  const pro = item.professional;
  if (!pro) return 'Details unavailable offline';
  const kind = pro.engineerProfile ? 'Engineer' : 'Service professional';
  const place = pro.baseCity ? ` · ${pro.baseCity}` : '';
  return `${kind}${place}${pro.isAvailable ? '' : ' · Currently unavailable'}`;
}

export function SavedScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const favoritesQ = useFavoritesList();
  const saved = favoritesQ.data ?? [];

  const open = (item: FavoriteDto) => {
    if (!item.professional) return;
    if (item.professional.engineerProfile) {
      navigation.navigate('EngineerProfile', {engineerId: item.professionalId});
    } else {
      navigation.navigate('ProviderProfile', {professionalProfileId: item.professionalId});
    }
  };

  return (
    <View style={styles.container}>
      <AppHeader title="Saved" subtitle="Your shortlisted professionals" onBack={() => navigation.goBack()} />
      <OfflineBanner force={favoritesQ.isOffline} onRetry={favoritesQ.refetch} />
      <FlatList
        data={saved}
        keyExtractor={item => item.professionalId}
        contentContainerStyle={[styles.list, {paddingBottom: insets.bottom + Spacing.xl}, !saved.length && styles.empty]}
        ListEmptyComponent={<EmptyState icon="heart-outline" title="Nothing saved yet" message="Save engineers and service professionals while comparing." actionLabel="Discover engineers" onAction={() => navigation.navigate('EngineerDiscovery')} />}
        renderItem={({item}) =>
          item.professional ? (
            <ProfessionalCard
              name={item.professional.fullName}
              avatarUrl={item.professional.avatarUrl ?? undefined}
              sub={subFor(item)}
              rating={item.professional.averageRating}
              reviews={item.professional.totalReviewsCount}
              verified={item.professional.verificationStatus === 'VERIFIED'}
              priceLabel={priceFor(item)}
              onPress={() => open(item)}
            />
          ) : (
            <View style={styles.offlineRow}>
              <Text style={styles.offlineName}>Saved professional</Text>
              <Text style={styles.offlineSub}>Details unavailable offline</Text>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: Colors.offWhite},
  list: {padding: Spacing.lg, gap: Spacing.sm},
  empty: {flexGrow: 1, justifyContent: 'center'},
  offlineRow: {backgroundColor: Colors.white, borderRadius: 14, padding: Spacing.lg, gap: 2},
  offlineName: {fontSize: 16, fontWeight: '700', color: Colors.navyDeep},
  offlineSub: {fontSize: 13, color: Colors.slate500},
});
