import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {Colors, Typography, Spacing} from '@nahtreek/design-system';
import {Icon, ICONS} from './Icon';

interface RatingStarsProps {
  rating: number;
  count?: number;
}

export function RatingStars({rating, count}: RatingStarsProps) {
  return (
    <View style={styles.row}>
      <Icon name={ICONS.star} size={14} color={Colors.navyDeep} />
      <Text style={styles.value}>{rating.toFixed(1)}</Text>
      {typeof count === 'number' && (
        <Text style={styles.count}>
          ({count.toLocaleString('en-IN')} reviews)
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  value: {
    ...Typography.caption,
    fontWeight: '700',
    color: Colors.slate800,
  },
  count: {
    ...Typography.caption,
    color: Colors.slate500,
    marginLeft: Spacing.xxs,
  },
});
