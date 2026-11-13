import {Platform} from 'react-native';

// Long-list tuning shared by both apps: a smaller render window, clipped
// offscreen views on Android, and steady batching. Lists stay smooth on
// low-end devices without changing what the user sees. Spread onto every
// vertical FlatList: <FlatList {...LIST_PERF} ... />.
export const LIST_PERF = {
  windowSize: 7,
  maxToRenderPerBatch: 10,
  updateCellsBatchingPeriod: 50,
  removeClippedSubviews: Platform.OS === 'android',
} as const;
