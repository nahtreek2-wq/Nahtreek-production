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
      <Icon name={ICONS.star} size={11} color={ClientColors.accentIcon} />
      <Text style={styles.label}>PRO</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: ClientColors.accentSoft,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: ClientColors.accent,
  },
  label: {
    ...Typography.badge,
    color: ClientColors.accentText,
    fontWeight: '800',
  },
});
