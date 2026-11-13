import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {Typography, BorderRadius, Spacing} from '@nahtreek/design-system';
import {ClientColors} from '../../design-system/tokens';
import {Icon, ICONS} from './Icon';

// Paid Pro membership marker: renders wherever a discovery card or profile
// shows a member (memberPriority/isMember from the API). Distinct from the
// blue Verified identity badge — this one means "pays for priority".
export function MemberBadge() {
  return (
    <View style={styles.badge} accessibilityLabel="Pro member">
      <Icon name={ICONS.star} size={11} color={ClientColors.white} />
      <Text style={styles.label}>PRO</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: ClientColors.primaryNavy,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  label: {
    ...Typography.badge,
    color: ClientColors.white,
    fontWeight: '800',
  },
});
