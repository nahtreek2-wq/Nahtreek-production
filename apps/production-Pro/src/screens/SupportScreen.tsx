import React, {useState} from 'react';
import {Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {useNavigation} from '@react-navigation/native';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {ScreenHeader} from '../components/ScreenHeader';
import {ScreenLoading} from '../components/ScreenLoading';
import {EmptyState} from '../components/EmptyState';
import {PrimaryButton} from '../components/PrimaryButton';
import {SupportThread, type SupportReplyView} from '../../../../packages/mobile-booking/SupportThread';
import {api} from '../services/apiClient';
import {useProToast} from '../stores/proToast';
import {ProColors, ProRadius, ProSpacing, ProType} from '../theme/professionalTheme';

type SupportTicket = {id: string; subject: string; message: string; bookingRef: string | null;
  status: 'OPEN' | 'ANSWERED' | 'RESOLVED'; adminReply: string | null; createdAt: string;
  replies?: SupportReplyView[]};

const TICKET_STATUS: Record<SupportTicket['status'], string> = {
  OPEN: 'Open — support will reply here',
  ANSWERED: 'Answered by support',
  RESOLVED: 'Resolved',
};

export function SupportScreen() {
  const navigation = useNavigation();
  const toast = useProToast();
  const cache = useQueryClient();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [bookingRef, setBookingRef] = useState('');
  const tickets = useQuery({
    queryKey: ['pro-support-tickets'],
    queryFn: () => api.get<{data: SupportTicket[]}>('/support/tickets/me?limit=20').then(res => res.data),
    retry: 1,
  });
  const file = useMutation({
    mutationFn: () => api.post('/support/tickets', {
      subject: subject.trim(), message: message.trim(),
      ...(bookingRef.trim() ? {bookingRef: bookingRef.trim()} : {}),
    }),
    onSuccess: () => {
      setSubject(''); setMessage(''); setBookingRef('');
      void cache.invalidateQueries({queryKey: ['pro-support-tickets']});
      toast('Support request sent. Replies appear here and in Notifications.', 'success');
    },
    onError: error => toast(error instanceof Error ? error.message : 'Could not send your request.', 'error'),
  });
  const valid = subject.trim().length >= 4 && message.trim().length >= 10;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const followUp = useMutation({
    mutationFn: (input: {ticketId: string; message: string}) =>
      api.post(`/support/tickets/${input.ticketId}/replies`, {message: input.message}),
    onSuccess: (_data, input) => {
      setDrafts(current => ({...current, [input.ticketId]: ''}));
      setReplyingTo(null);
      void cache.invalidateQueries({queryKey: ['pro-support-tickets']});
      toast('Reply sent. Support will follow up here.', 'success');
    },
    onError: error => toast(error instanceof Error ? error.message : 'Could not send your reply.', 'error'),
    onSettled: () => setReplyingTo(null),
  });

  return (
    <View style={styles.root}>
      <ScreenHeader title="Help & support" subtitle="Payments, dues and account issues" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={tickets.isRefetching}
            onRefresh={() => void tickets.refetch()}
            tintColor={ProColors.primary}
            colors={[ProColors.primary]}
          />
        }>
        <Text style={styles.section}>Contact support</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Subject</Text>
          <TextInput accessibilityLabel="Support subject" style={styles.input} value={subject} onChangeText={setSubject}
            placeholder="e.g. Dues payment not reflecting" placeholderTextColor={ProColors.muted} maxLength={120} />
          <Text style={styles.label}>Job or booking ID (optional)</Text>
          <TextInput accessibilityLabel="Job or booking ID" style={styles.input} value={bookingRef} onChangeText={setBookingRef}
            placeholder="Paste from the job" placeholderTextColor={ProColors.muted} maxLength={40} autoCapitalize="none" />
          <Text style={styles.label}>Describe the issue</Text>
          <TextInput accessibilityLabel="Issue description" style={[styles.input, styles.multiline]} value={message} onChangeText={setMessage}
            multiline placeholder="What happened? Include dates and amounts if it is about money."
            placeholderTextColor={ProColors.muted} maxLength={2000} />
          <PrimaryButton label="Send support request" loading={file.isPending}
            disabled={!valid || file.isPending} onPress={() => file.mutate()} />
        </View>
        <Text style={styles.section}>My support requests</Text>
        {tickets.isPending ? <ScreenLoading label="Loading your requests…" /> : tickets.isError || !tickets.data ? (
          <EmptyState title="Could not load your requests" message="Check your connection and try again."
            actionLabel={tickets.isFetching ? 'Checking…' : 'Try again'} onAction={() => void tickets.refetch()} />
        ) : tickets.data.length ? tickets.data.map(ticket => {
          const draft = drafts[ticket.id] ?? '';
          const sending = followUp.isPending && replyingTo === ticket.id;
          return (
          <View key={ticket.id} style={styles.card}>
            <Text style={styles.subject}>{ticket.subject}</Text>
            <Text style={styles.status}>{TICKET_STATUS[ticket.status]}</Text>
            <Text style={styles.message}>{ticket.message}</Text>
            {ticket.replies ? (
              <SupportThread replies={ticket.replies} />
            ) : ticket.adminReply ? (
              <View style={styles.replyBox}>
                <Text style={styles.replyLabel}>Support reply</Text>
                <Text style={styles.replyText}>{ticket.adminReply}</Text>
              </View>
            ) : null}
            <View style={styles.replyRow}>
              <TextInput accessibilityLabel={`Reply to ${ticket.subject}`} style={[styles.input, styles.replyInput]}
                value={draft} onChangeText={text => setDrafts(current => ({...current, [ticket.id]: text}))}
                placeholder="Write a follow-up…" placeholderTextColor={ProColors.muted} maxLength={2000}
                multiline editable={!sending} />
              <Pressable accessibilityRole="button" accessibilityLabel={sending ? 'Sending reply' : `Send reply to ${ticket.subject}`}
                disabled={draft.trim().length < 2 || sending}
                onPress={() => { setReplyingTo(ticket.id); followUp.mutate({ticketId: ticket.id, message: draft.trim()}); }}
                style={[styles.send, (draft.trim().length < 2 || sending) && {opacity: 0.5}]}>
                <MaterialCommunityIcons name="send" size={20} color={ProColors.onAccent} />
              </Pressable>
            </View>
          </View>
          );
        }) : (
          <EmptyState icon="lifebuoy" title="No support requests yet"
            message="Replies from the team appear here." />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: ProColors.background},
  body: {padding: ProSpacing.md, gap: ProSpacing.sm},
  section: {...ProType.section, color: ProColors.text, marginTop: ProSpacing.xs},
  card: {backgroundColor: ProColors.surface, borderRadius: ProRadius.card, padding: ProSpacing.md, gap: ProSpacing.sm,
    borderWidth: 1, borderColor: ProColors.border},
  label: {...ProType.meta, color: ProColors.secondary, fontWeight: '600'},
  input: {borderWidth: 1, borderColor: ProColors.border, borderRadius: ProRadius.input, padding: 12,
    fontSize: 16, color: ProColors.text, backgroundColor: ProColors.surface},
  multiline: {minHeight: 110, textAlignVertical: 'top'},
  subject: {fontSize: 16, fontWeight: '700', color: ProColors.text},
  status: {...ProType.meta, color: ProColors.primary, fontWeight: '700'},
  message: {...ProType.body, color: ProColors.secondary},
  replyBox: {backgroundColor: ProColors.blueSoft, borderRadius: ProRadius.input, padding: ProSpacing.sm, gap: 2},
  replyLabel: {...ProType.meta, fontWeight: '700', color: ProColors.primary},
  replyText: {...ProType.body, color: ProColors.text},
  replyRow: {flexDirection: 'row', alignItems: 'flex-end', gap: ProSpacing.sm},
  replyInput: {flex: 1, minHeight: 48, maxHeight: 120},
  send: {width: 48, height: 48, borderRadius: 24, backgroundColor: ProColors.primary,
    alignItems: 'center', justifyContent: 'center'},
});
