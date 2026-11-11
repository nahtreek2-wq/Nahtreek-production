import React from 'react';
import {FlatList, StyleSheet, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {AppHeader, Button} from '../components/ui';
import {
  serviceRequestStatusLabel,
  usePlatformHistory,
  type Activity,
  type ServiceRequest,
} from '../services/platformQueries';
import type {RootStackParamList} from '../navigation/types';
import {ClientColors} from '../design-system/tokens';
export const platformStyles = StyleSheet.create({
  root: {flex: 1, backgroundColor: ClientColors.lightBackground},
  body: {padding: 20, paddingBottom: 36},
  card: {
    backgroundColor: ClientColors.white,
    padding: 20,
    borderRadius: 16,
    marginBottom: 12,
    gap: 12,
  },
  row: {flexDirection: 'row', alignItems: 'center', gap: 12},
  title: {fontSize: 20, fontWeight: '700', color: ClientColors.primaryText},
  text: {fontSize: 16, lineHeight: 24, color: ClientColors.secondaryText},
});
export function PlatformHistoryScreen({
  activity = false,
}: {
  activity?: boolean;
}) {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const history = usePlatformHistory(
    activity ? 'history/me' : 'service-requests',
  );
  return (
    <View style={platformStyles.root}>
      <AppHeader
        title={activity ? 'Account history' : 'Home service requests'}
        onBack={() => nav.goBack()}
      />
      <FlatList
        contentContainerStyle={platformStyles.body}
        data={history.data?.pages.flatMap(page => page.data) ?? []}
        keyExtractor={item => item.id}
        refreshing={history.isRefetching}
        onRefresh={() => void history.refetch()}
        ListEmptyComponent={
          <View style={platformStyles.card}>
            <Text style={platformStyles.title}>
              {history.isPending
                ? 'Loading history…'
                : history.isError
                ? 'Could not load history'
                : 'No history yet'}
            </Text>
            <Text style={platformStyles.text}>
              Your completed account actions and requests appear here.
            </Text>
            {history.isError ? (
              <Button
                label="Try again"
                onPress={() => void history.refetch()}
              />
            ) : null}
          </View>
        }
        ListFooterComponent={
          history.hasNextPage ? (
            <Button
              label="Show more"
              loading={history.isFetchingNextPage}
              onPress={() => void history.fetchNextPage()}
            />
          ) : null
        }
        renderItem={({item}) =>
          activity ? (
            <View style={platformStyles.card}>
              <Text style={platformStyles.title}>
                {(item as Activity).action.replace(/_/g, ' ').toLowerCase()}
              </Text>
              <Text style={platformStyles.text}>
                {(item as Activity).metadata?.title ??
                  (item as Activity).entity}
              </Text>
              <Text style={platformStyles.text}>
                {new Date(item.createdAt).toLocaleString()}
              </Text>
            </View>
          ) : (
            <View style={platformStyles.card}>
              <Text style={platformStyles.title}>
                {(item as ServiceRequest).category.title}
              </Text>
              <Text style={platformStyles.text}>
                {(item as ServiceRequest).provider.fullName} ·{' '}
                {serviceRequestStatusLabel(
                  (item as ServiceRequest).journey?.stage,
                  (item as ServiceRequest).status,
                )}
              </Text>
              <Button
                label="View request"
                variant="secondary"
                onPress={() =>
                  nav.navigate('ServiceRequestDetail', {requestId: item.id})
                }
              />
            </View>
          )
        }
      />
    </View>
  );
}
export function ActivityHistoryScreen() {
  return <PlatformHistoryScreen activity />;
}
