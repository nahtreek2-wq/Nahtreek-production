import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {Colors} from '@nahtreek/design-system';
import {ProColors, ProRadius, ProSpacing, ProType} from '../theme/professionalTheme';

export type QuickActionRoute = 'Requests' | 'Schedule' | 'Messages' | 'Profile' | 'Reviews' | 'Notifications';

type Action = {
  route: QuickActionRoute;
  label: string;
  icon: string;
  badge?: number;
};

export function QuickActions({
  pending,
  unread,
  onNavigate,
}: {
  pending: number;
  unread?: number;
  onNavigate: (route: QuickActionRoute) => void;
}) {
  const actions: Action[] = [
    {route: 'Requests', label: 'My Jobs', icon: 'briefcase-outline', badge: pending > 0 ? pending : undefined},
    {route: 'Schedule', label: 'My Time', icon: 'calendar-clock-outline'},
    {route: 'Messages', label: 'Chat', icon: 'message-text-outline', badge: unread && unread > 0 ? unread : undefined},
    {route: 'Reviews', label: 'Reviews', icon: 'star-circle-outline'},
    {route: 'Notifications', label: 'Alerts', icon: 'bell-outline'},
    {route: 'Profile', label: 'My Profile', icon: 'account-outline'},
  ];
  return (
    <View style={styles.grid}>
      {actions.map(action => (
        <Pressable
          key={action.route}
          accessibilityRole="button"
          accessibilityLabel={action.badge ? `${action.label}, ${action.badge} new` : action.label}
          onPress={() => onNavigate(action.route)}
          style={({pressed}) => [styles.tile, pressed && styles.pressed]}>
          {action.badge ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{action.badge > 9 ? '9+' : action.badge}</Text>
            </View>
          ) : null}
          <View style={styles.iconWrap}>
            <MaterialCommunityIcons name={action.icon} size={24} color={ProColors.primary} />
          </View>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={styles.label}>{action.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: ProSpacing.sm, marginBottom: ProSpacing.xl},
  tile: {
    flexBasis: '31%',
    flexGrow: 1,
    minHeight: 98,
    backgroundColor: ProColors.surface,
    borderRadius: ProRadius.card,
    borderWidth: 1,
    borderColor: ProColors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: ProSpacing.md,
    paddingHorizontal: 4,
    gap: 6,
  },
  pressed: {opacity: 0.85},
  iconWrap: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {...ProType.action, fontSize: 13, lineHeight: 17, color: Colors.navyDeep, textAlign: 'center'},
  badge: {
    position: 'absolute',
    top: ProSpacing.xs,
    right: ProSpacing.xs,
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.navyDeep,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {fontSize: 12, fontWeight: '700', color: Colors.white},
});
