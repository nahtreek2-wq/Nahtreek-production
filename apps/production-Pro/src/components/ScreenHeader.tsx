import React, {useEffect, useState} from 'react';
import {Image, Pressable, StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {Colors} from '@nahtreek/design-system';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {mediaUrl} from '../services/media';
import {headerStyles} from '../../../../packages/mobile-ui/headerStyles';
import {ProColors, ProSpacing, ProType} from '../theme/professionalTheme';

function HeaderAvatar({url, onPress}: {url?: string; onPress?: () => void}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? 'Open profile' : 'Professional profile photo'}
      onPress={onPress}
      disabled={!onPress}
      style={({pressed}) => [styles.avatarButton, pressed && styles.avatarPressed]}>
      {url && !failed ? (
        <Image
          accessibilityLabel="Professional profile photo"
          source={{uri: mediaUrl(url)}}
          style={styles.avatar}
          onError={() => setFailed(true)}
        />
      ) : (
        <MaterialCommunityIcons name="account-outline" size={22} color={Colors.navyDeep} />
      )}
    </Pressable>
  );
}

export function ScreenHeader({title, subtitle, avatarUrl, onAvatarPress, onBack, right, showBrand = false, tone = 'navy', city, onCityPress, onNotificationsPress}: {title: string; subtitle?: string; avatarUrl?: string; onAvatarPress?: () => void; onBack?: () => void; right?: React.ReactNode; showBrand?: boolean; tone?: 'navy' | 'light'; city?: string; onCityPress?: () => void; onNotificationsPress?: () => void}) {
  const insets = useSafeAreaInsets();
  const {width, fontScale} = useWindowDimensions();
  const compact = width < 360 || fontScale > 1.2;
  if (showBrand) {
    return (
      <View style={[styles.root, styles.homeRoot, {paddingTop: insets.top + ProSpacing.sm}]}>
        <View style={styles.homeBrandLine}>
          <View style={[styles.homeLogoFrame, compact && styles.compactLogoFrame]} accessibilityRole="image" accessibilityLabel="NAHTREEK logo">
            <Image source={require('../assets/nahtreek-logo.png')} style={[styles.homeLogo, compact && styles.compactLogo]} />
          </View>
          <View style={styles.brandBlock}>
            <Text numberOfLines={1} allowFontScaling={false} style={[styles.brand, compact && styles.compactBrand]}>NAHTREEK</Text>
            <View style={styles.tagRow}>
              <Text numberOfLines={1} allowFontScaling={false} style={[styles.product, compact && styles.compactProduct]}>PRO</Text>
              {onCityPress ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Work area, current ${city || 'not selected'}`}
                  hitSlop={10}
                  onPress={onCityPress}
                  style={styles.cityRow}>
                  {!compact ? <MaterialCommunityIcons name="map-marker" size={14} color={ProColors.accent} /> : null}
                  <Text numberOfLines={1} style={[styles.city, compact && styles.compactCity]}>{city || 'Set work area'}</Text>
                  <MaterialCommunityIcons name="chevron-down" size={compact ? 12 : 14} color={ProColors.accent} />
                </Pressable>
              ) : null}
            </View>
          </View>
          <View style={styles.actions}>
            {onNotificationsPress ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Notifications"
                onPress={onNotificationsPress}
                style={styles.iconButton}>
                <MaterialCommunityIcons name="bell-outline" size={21} color={Colors.white} />
              </Pressable>
            ) : null}
            {right}
            <HeaderAvatar url={avatarUrl} onPress={onAvatarPress} />
          </View>
        </View>
        <View style={styles.homeCopy}>
          <Text accessibilityRole="header" numberOfLines={1} style={styles.homeTitle}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
      </View>
    );
  }
  const light = tone === 'light' && !showBrand;
  return (
    <View style={[styles.root, light && styles.lightRoot, {paddingTop: insets.top + ProSpacing.sm}]}>
      <View style={styles.topLine}>
        <View style={styles.leading}>
          {onBack ? <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={onBack} style={({pressed}) => [styles.back, light && styles.lightBack, pressed && styles.backPressed]}><MaterialCommunityIcons name="arrow-left" size={24} color={light ? ProColors.primary : Colors.white} /></Pressable> : null}
          <Text accessibilityRole="header" style={[styles.title, compact && styles.titleCompact, light && styles.lightTitle]} numberOfLines={2}>{title}</Text>
        </View>
        <View style={styles.actions}>
          {avatarUrl ? <HeaderAvatar url={avatarUrl} /> : null}
          {right}
        </View>
      </View>
      {subtitle ? <View style={styles.copy}><Text style={light ? styles.lightSubtitle : headerStyles.subtitle}>{subtitle}</Text></View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  homeRoot: {
    paddingBottom: ProSpacing.lg,
  },
  homeBrandLine: {minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: ProSpacing.sm},
  homeLogoFrame: {width: 46, height: 46, overflow: 'hidden', justifyContent: 'center', alignItems: 'center', alignSelf: 'center', flexShrink: 0},
  // The artwork fills ~82% of its file; oversize it so the visible mark matches Home's 46px.
  homeLogo: {width: 56, height: 56, resizeMode: 'contain'},
  compactLogoFrame: {width: 36, height: 36},
  compactLogo: {width: 44, height: 44},
  homeCopy: {marginTop: ProSpacing.md},
  brandBlock: {flex: 1, minWidth: 0},
  tagRow: {flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 1},
  brand: {fontSize: 22, lineHeight: 26, fontWeight: '800', color: ProColors.surface, letterSpacing: 1, includeFontPadding: false},
  compactBrand: {fontSize: 17, lineHeight: 21, letterSpacing: 0.8},
  product: {fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 3, color: ProColors.accent, includeFontPadding: false, flexShrink: 0},
  compactProduct: {fontSize: 11, lineHeight: 14, letterSpacing: 2},
  cityRow: {flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4},
  city: {fontSize: 14, lineHeight: 19, color: Colors.white, flexShrink: 1, includeFontPadding: false},
  compactCity: {fontSize: 12, lineHeight: 17},
  iconButton: {width: 40, height: 40, alignItems: 'center', justifyContent: 'center'},
  homeTitle: {...ProType.section, color: ProColors.surface},
  subtitle: {...ProType.meta, color: '#CED9E8', marginTop: 3},
  avatarButton: {width: 40, height: 40, borderRadius: 20, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.offWhite},
  avatarPressed: {opacity: 0.76, transform: [{scale: 0.96}]},
  avatar: {width: '100%', height: '100%', borderRadius: 20},
  root: {...headerStyles.container, backgroundColor: Colors.navyDeep, paddingHorizontal: ProSpacing.xl, paddingBottom: ProSpacing.md},
  topLine: {...headerStyles.row, flexWrap: 'nowrap'},
  leading: headerStyles.leading,
  actions: headerStyles.actions,
  back: headerStyles.navigation,
  backPressed: {opacity: 0.75, transform: [{scale: 0.94}]},
  lightRoot: {backgroundColor: ProColors.surface, borderBottomWidth: 1, borderColor: ProColors.border, paddingBottom: ProSpacing.md},
  lightTitle: {color: ProColors.text},
  lightSubtitle: {...ProType.meta, color: ProColors.secondary},
  lightBack: {backgroundColor: ProColors.surface, borderColor: ProColors.border, shadowOpacity: 0.1},
  title: {...ProType.screen, color: ProColors.surface, flex: 1, minWidth: 0},
  titleCompact: {fontSize: 20, lineHeight: 26},
  copy: {...headerStyles.copy, marginTop: 0},
});
