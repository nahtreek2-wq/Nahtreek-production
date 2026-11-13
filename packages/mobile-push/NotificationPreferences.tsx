import React from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Switch, Text, View} from 'react-native';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {Colors} from '../design-system/src';

type Preferences = {requestUpdates: boolean; messages: boolean; offers: boolean};
type Props = {load: () => Promise<Preferences>; save: (value: Partial<Preferences>) => Promise<Preferences>};
const rows: {key: keyof Preferences; title: string; description: string}[] = [
  {key: 'requestUpdates', title: 'Request updates', description: 'Bookings, progress and completed work'},
  {key: 'messages', title: 'Messages', description: 'Alerts when someone sends you a message'},
  {key: 'offers', title: 'Helpful reminders and tips', description: 'Up to one a week, between 9 am and 8 pm IST. Optional.'},
];
export function NotificationPreferences({load, save}: Props) {
  const client = useQueryClient();
  const query = useQuery({queryKey: ['notification-preferences'], queryFn: load});
  const update = useMutation({mutationFn: save, onSuccess: value => client.setQueryData(['notification-preferences'], value)});
  if (query.isPending) return <ActivityIndicator accessibilityLabel="Loading notification preferences" color={Colors.navyDeep} />;
  if (query.isError || !query.data) return <View style={styles.card}><Text style={styles.error}>Could not load notification settings.</Text><Pressable accessibilityRole="button" style={styles.retry} onPress={() => void query.refetch()}><Text style={styles.title}>Try again</Text></Pressable></View>;
  return <View>
    <View style={styles.card}>{rows.map(row => <View key={row.key} style={styles.row}><View style={styles.copy}><Text style={styles.title}>{row.title}</Text><Text style={styles.detail}>{row.description}</Text></View><Switch accessibilityLabel={row.title} disabled={update.isPending} value={query.data[row.key]} onValueChange={value => update.mutate({[row.key]: value})} trackColor={{false: Colors.slate200, true: Colors.navyDeep}} thumbColor={Colors.white} /></View>)}</View>
    <Text accessibilityLiveRegion="polite" style={update.isError ? styles.error : styles.detail}>{update.isPending ? 'Saving…' : update.isError ? 'Could not save. Your previous settings still apply. Try again.' : update.isSuccess ? 'Settings saved to your account.' : 'These preferences apply to every device signed in to this account. Account security updates stay enabled.'}</Text>
  </View>;
}
const styles = StyleSheet.create({card: {backgroundColor: Colors.white, borderRadius: 16, borderWidth: 1, borderColor: Colors.slate200, overflow: 'hidden'}, row: {padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.slate200}, copy: {flex: 1}, title: {fontSize: 16, fontWeight: '600', color: Colors.slate900}, detail: {fontSize: 13, lineHeight: 20, color: Colors.slate500, marginTop: 8}, error: {fontSize: 14, color: Colors.error, paddingVertical: 12}, retry: {minHeight: 48, justifyContent: 'center', paddingHorizontal: 16}});
