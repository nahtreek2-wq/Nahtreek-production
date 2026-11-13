import React from 'react';
import {Image, Pressable, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from '@nahtreek/design-system';
import {HERO_PHOTOS, workPhotoFor} from '../../assets/imagery';

type Tile = {
  key: string;
  label: string;
  photo: number;
  engineers?: boolean;
};

const TILES: Tile[] = [
  {key: 'plumbing', label: 'Plumbing', photo: workPhotoFor('plumbing')},
  {key: 'electrical', label: 'Electrical', photo: workPhotoFor('electrical')},
  {key: 'painting', label: 'Painting', photo: workPhotoFor('painting')},
  {key: 'carpentry', label: 'Carpentry', photo: workPhotoFor('carpentry')},
  {key: 'masonry', label: 'Masonry', photo: workPhotoFor('masonry')},
  {key: 'ac', label: 'AC Service', photo: workPhotoFor('ac')},
  {key: 'cleaning', label: 'Cleaning', photo: workPhotoFor('cleaning')},
  {key: 'engineers', label: 'Engineers', photo: HERO_PHOTOS.planning, engineers: true},
];

export const CATEGORY_SERVICE_IDS: Record<string, string> = {
  plumbing: 'plumbing',
  electrical: 'electrical',
  painting: 'painting',
  carpentry: 'carpentry',
  masonry: 'masonry',
  ac: 'ac',
  cleaning: 'cleaning',
};

type Props = {
  onSelectService: (serviceKey: string) => void;
  onSelectEngineers: () => void;
};

export function CategoryGrid({onSelectService, onSelectEngineers}: Props) {
  const {width: screenWidth} = useWindowDimensions();
  const tileWidth = Math.floor((screenWidth - 40) / 4) - 6;
  const photoSize = tileWidth;
  return (
    <View style={styles.section} testID="home-category-grid">
      <Text style={styles.title}>What do you need?</Text>
      <View style={styles.grid}>
        {TILES.map(tile => (
          <Pressable
            key={tile.key}
            accessibilityRole="button"
            accessibilityLabel={tile.label}
            onPress={tile.engineers ? onSelectEngineers : () => onSelectService(tile.key)}
            style={({pressed}) => [styles.tile, {width: tileWidth}, pressed && styles.tilePressed]}>
            <Image
              source={tile.photo}
              style={[styles.photo, {width: photoSize, height: photoSize}]}
              resizeMode="cover"
            />
            <Text numberOfLines={1} adjustsFontSizeToFit style={styles.label}>
              {tile.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: Spacing.md,
  },
  title: {
    ...Typography.h2,
    color: Colors.slate900,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: Spacing.sm + 4,
    rowGap: Spacing.sm + 4,
  },
  tile: {
    alignItems: 'center',
  },
  tilePressed: {
    opacity: 0.85,
  },
  photo: {
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.slate100,
  },
  label: {
    ...Typography.caption,
    color: Colors.slate900,
    marginTop: Spacing.xs,
    textAlign: 'center',
  },
});
