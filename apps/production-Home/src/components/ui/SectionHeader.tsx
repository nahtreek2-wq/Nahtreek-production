import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import {Colors, Typography, Spacing} from '@nahtreek/design-system';
import {Icon, ICONS} from './Icon';

interface SectionHeaderProps {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function SectionHeader({title, actionLabel, onAction}: SectionHeaderProps) {
  return (
    <View style={styles.row}>
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      {actionLabel && onAction && (
        <TouchableOpacity accessibilityRole="button" style={styles.action} onPress={onAction}>
          <Text style={styles.actionLabel}>{actionLabel}</Text>
          <Icon name={ICONS.chevronRight} size={14} color={Colors.navyMid} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm + Spacing.xs,
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  title: {
    ...Typography.h3,
    flexShrink: 1,
    color: Colors.slate900,
  },
  action: {
    minHeight: 48,
    minWidth: 48,
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionLabel: {
    ...Typography.caption,
    fontWeight: '600',
    color: Colors.navyMid,
  },
});
