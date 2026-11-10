import React from 'react';
import {Image, StyleSheet, View} from 'react-native';

const ENGINEER = require('../assets/professionals/engineer-job-detail-v1.jpg');
const PLUMBING = require('../assets/professionals/plumbing-job-detail-v1.jpg');
const PAINTING = require('../assets/professionals/painting-job-detail-v1.jpg');
const ELECTRICAL = require('../assets/professionals/electrical-job-detail-v1.jpg');
const CARPENTRY = require('../assets/professionals/carpentry-job-detail-v1.jpg');
const CLEANING = require('../assets/professionals/cleaning-job-detail-v1.jpg');
const APPLIANCE = require('../assets/professionals/appliance-job-detail-v1.jpg');
const MASONRY = require('../assets/professionals/masonry-job-detail-v1.jpg');

const SERVICE_PHOTOS: {match: string[]; source: unknown; label: string}[] = [
  {match: ['plumb', 'pipe', 'tap', 'bathroom fitting', 'sanitary'], source: PLUMBING, label: 'Professional plumbing work'},
  {match: ['paint', 'wallpaper', 'whitewash'], source: PAINTING, label: 'Professional painting work'},
  {match: ['electric', 'wiring', 'switch', 'fan installation', 'light'], source: ELECTRICAL, label: 'Professional electrical work'},
  {match: ['carpent', 'wood', 'furniture', 'door', 'cabinet', 'modular kitchen'], source: CARPENTRY, label: 'Professional carpentry work'},
  {match: ['clean', 'housekeeping', 'deep clean', 'sofa', 'carpet'], source: CLEANING, label: 'Professional home cleaning'},
  {match: ['appliance', 'ac service', 'air conditioner', 'washing machine', 'fridge', 'refrigerator', 'microwave', 'chimney', 'geyser', 'tv mount'], source: APPLIANCE, label: 'Professional appliance repair'},
  {match: ['mason', 'cement', 'plaster', 'brick', 'tile', 'flooring', 'construction', 'civil'], source: MASONRY, label: 'Professional masonry work'},
];

function hashTitle(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 2147483647;
  }
  return Math.abs(hash);
}

/** Bundled, role-aware visuals. Known categories show their own photo; anything else gets a stable per-job photo (seeded by id when given) so rows never repeat the same image. */
export function JobContextVisual({kind, title, seed, size = 52}: {kind: 'engineering' | 'service'; title: string; seed?: string; size?: number}) {
  const label = title.toLowerCase();
  if (kind === 'engineering') {
    return <View style={[styles.frame, {width: size, height: size}]}><Image source={ENGINEER} style={styles.image} resizeMode="cover" accessibilityLabel="Engineer reviewing site plans" /></View>;
  }
  const photo = SERVICE_PHOTOS.find(entry => entry.match.some(keyword => label.includes(keyword)))
    ?? SERVICE_PHOTOS[hashTitle(`${label}::${seed ?? ''}`) % SERVICE_PHOTOS.length];
  return <View style={[styles.frame, {width: size, height: size}]}><Image source={photo.source as never} style={styles.image} resizeMode="cover" accessibilityLabel={photo.label} /></View>;
}

const styles = StyleSheet.create({frame: {borderRadius: 12, overflow: 'hidden'}, image: {width: '100%', height: '100%'}});
