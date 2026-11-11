import React, {useState} from 'react';
import {Image, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {useQueryClient} from '@tanstack/react-query';
import {BorderRadius, Colors, Spacing, Typography} from '@nahtreek/design-system';
import {PrimaryButton} from './PrimaryButton';
import {usePortfolioPhotos} from '../hooks/usePortfolioPhotos';
import {mediaUrl} from '../services/media';

export type WorkPhotoItem = {
  id: string;
  title: string;
  description?: string;
  imageUrl: string;
};

// Work gallery manager used during profile setup: shows the photos already on
// the public profile and lets the professional add or remove them. Upload
// rules live in usePortfolioPhotos, shared with the preview screen.
export function WorkPhotosSection({items}: {items: WorkPhotoItem[]}) {
  const queryClient = useQueryClient();
  const {photoTitle, setPhotoTitle, uploading, uploadError, addWorkPhoto, removePhoto} =
    usePortfolioPhotos(() => queryClient.invalidateQueries({queryKey: ['professional-profile']}));

  return (
    <View style={styles.root}>
      {items.length ? (
        items.map(item => (
          <View key={item.id} style={styles.row}>
            <WorkPhotoThumb uri={mediaUrl(item.imageUrl)} />
            <View style={styles.copy}>
              <Text style={styles.title} numberOfLines={2}>
                {item.title}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.title}`}
                onPress={() => removePhoto(item.id, item.title)}
                style={styles.remove}>
                <Text style={styles.removeText}>Remove photo</Text>
              </Pressable>
            </View>
          </View>
        ))
      ) : (
        <View style={styles.empty}>
          <MaterialCommunityIcons name="image-plus" size={30} color={Colors.slate400} />
          <Text style={styles.emptyText}>Add clear photos of your own completed work.</Text>
        </View>
      )}
      <Text style={styles.label}>Work photo title</Text>
      <TextInput
        accessibilityLabel="Work photo title"
        placeholder="Describe this work briefly"
        placeholderTextColor={Colors.slate500}
        value={photoTitle}
        onChangeText={setPhotoTitle}
        maxLength={120}
        style={styles.input}
      />
      <Text style={styles.note}>Only upload your own work. These photos are public; do not upload identity documents.</Text>
      {uploadError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {uploadError}
        </Text>
      ) : null}
      <PrimaryButton label="Add work photo" loading={uploading} onPress={addWorkPhoto} style={styles.add} />
    </View>
  );
}

function WorkPhotoThumb({uri}: {uri?: string}) {
  const [failed, setFailed] = useState(false);
  if (failed || !uri) {
    return (
      <View style={[styles.thumb, styles.thumbFallback]}>
        <MaterialCommunityIcons name="image-off-outline" size={24} color={Colors.slate500} />
      </View>
    );
  }
  return <Image source={{uri}} style={styles.thumb} onError={() => setFailed(true)} />;
}

const styles = StyleSheet.create({
  root: {gap: Spacing.sm, marginTop: Spacing.md},
  row: {flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.slate200, borderRadius: BorderRadius.lg, padding: Spacing.sm},
  thumb: {width: 64, height: 64, borderRadius: BorderRadius.md, backgroundColor: Colors.slate100},
  thumbFallback: {alignItems: 'center', justifyContent: 'center'},
  copy: {flex: 1, minWidth: 0},
  title: {...Typography.body, color: Colors.slate900, fontWeight: '700'},
  remove: {minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start'},
  removeText: {...Typography.body, color: Colors.error},
  empty: {alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.slate200, borderRadius: BorderRadius.lg, padding: Spacing.lg},
  emptyText: {...Typography.body, color: Colors.slate600, textAlign: 'center'},
  label: {...Typography.caption, color: Colors.slate700, fontWeight: '700', marginTop: Spacing.sm},
  input: {...Typography.body, minHeight: 52, color: Colors.slate900, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.slate200, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md},
  note: {...Typography.caption, color: Colors.slate500},
  error: {...Typography.caption, color: Colors.error},
  add: {marginTop: Spacing.sm},
});
