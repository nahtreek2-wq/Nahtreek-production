import React from 'react';
import {Animated, StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {ScreenHeader} from '../components/ScreenHeader';
import {ProButton} from '../components/ProButton';
import {NotificationPreferences} from '../../../../packages/mobile-push/NotificationPreferences';
import {api} from '../services/apiClient';
import {ScrollMotionBar, useScrollMotion} from '../components/ScrollMotionBar';
import {ProColors, ProSpacing} from '../theme/professionalTheme';
type Preferences = {
  requestUpdates: boolean;
  messages: boolean;
  offers: boolean;
};
const load = () => api.get<Preferences>('/notifications/preferences');
const save = (value: Partial<Preferences>) =>
  api.patch<Preferences>('/notifications/preferences', value);
export function NotificationSettingsScreen() {
  const navigation = useNavigation();
  const scrollMotion = useScrollMotion();
  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Notification settings"
        subtitle="Choose the updates you receive"
        onBack={() => navigation.goBack()}
      />
      <ScrollMotionBar offset={scrollMotion.offset} reducedMotion={scrollMotion.reducedMotion} />
      <Animated.ScrollView
        onScroll={scrollMotion.onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={styles.body}>
        <NotificationPreferences load={load} save={save} />
        <ProButton label="Back to profile" variant="secondary" onPress={() => navigation.goBack()} />
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: ProColors.background},
  body: {padding: ProSpacing.xl, paddingBottom: ProSpacing.huge, gap: ProSpacing.xxl},
});
