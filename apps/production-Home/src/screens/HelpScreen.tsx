import React, {useState} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {
  Colors,
  Typography,
  Spacing,
  BorderRadius,
} from '@nahtreek/design-system';
import {AppHeader, Button, Card, Icon, ICONS, Input, SectionHeader} from '../components/ui';
import {SupportThread, type SupportReplyView} from '../../../../packages/mobile-booking/SupportThread';
import {api} from '../services/apiClient';
import {useSessionStore} from '../stores/session';
import {useToast} from '../stores/toast';
import type {RootStackParamList} from '../navigation/types';

type SupportTicket = {id: string; subject: string; message: string; bookingRef: string | null;
  status: 'OPEN' | 'ANSWERED' | 'RESOLVED'; adminReply: string | null; createdAt: string;
  replies?: SupportReplyView[]};

const TICKET_STATUS: Record<SupportTicket['status'], string> = {
  OPEN: 'Open — support will reply here',
  ANSWERED: 'Answered by support',
  RESOLVED: 'Resolved',
};

const FAQS = [
  {
    q: 'How do I book a service?',
    a: 'Choose a professional, describe your requirement and location, review the details, then send your request. Follow updates in Requests.',
  },
  {
    q: 'Can I cancel a booking or request?',
    a: 'You can cancel a pending or accepted request when the Cancel action is available. Other arrangements should be discussed with the professional.',
  },
  {
    q: 'How do I receive progress updates?',
    a: 'Open Request details to see status updates. Messages open as soon as your request exists — you can clarify details before acceptance.',
  },
  {
    q: 'What happens without internet?',
    a: 'You need an internet connection to send requests, messages and account changes. A failed action has not been confirmed; retry when connected.',
  },
];

export function HelpScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const token = useSessionStore(state => state.accessToken);
  const cache = useQueryClient();
  const [open, setOpen] = useState<number | null>(0);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [bookingRef, setBookingRef] = useState('');
  const tickets = useQuery({
    queryKey: ['support-tickets'],
    queryFn: () => api.get<{data: SupportTicket[]}>('/support/tickets/me?limit=20').then(res => res.data),
    enabled: Boolean(token),
    retry: 1,
  });
  const file = useMutation({
    mutationFn: () => api.post('/support/tickets', {
      subject: subject.trim(), message: message.trim(),
      ...(bookingRef.trim() ? {bookingRef: bookingRef.trim()} : {}),
    }),
    onSuccess: () => {
      setSubject(''); setMessage(''); setBookingRef('');
      void cache.invalidateQueries({queryKey: ['support-tickets']});
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
      void cache.invalidateQueries({queryKey: ['support-tickets']});
      toast('Reply sent. Support will follow up here.', 'success');
    },
    onError: error => toast(error instanceof Error ? error.message : 'Could not send your reply.', 'error'),
    onSettled: () => setReplyingTo(null),
  });

  return (
    <View style={styles.container}>
      <AppHeader
        title="Help and support"
        subtitle="Guidance for your requests and account"
        onBack={() => navigation.goBack()}
      />
      <ScrollView
        contentContainerStyle={[
          styles.body,
          {paddingBottom: insets.bottom + Spacing.xl},
        ]}
        showsVerticalScrollIndicator={false}>
        <SectionHeader title="Frequently asked questions" />
        {FAQS.map((f, i) => (
          <Card key={f.q} style={styles.faq}>
            <TouchableOpacity
              style={styles.faqHead}
              accessibilityRole="button"
              accessibilityLabel={f.q}
              accessibilityState={{expanded: open === i}}
              onPress={() => setOpen(open === i ? null : i)}>
              <Text style={styles.faqQ}>{f.q}</Text>
              <Icon
                name={ICONS.chevronDown}
                size={16}
                color={Colors.slate500}
                style={open === i ? styles.faqOpen : undefined}
              />
            </TouchableOpacity>
            {open === i && <Text style={styles.faqA}>{f.a}</Text>}
          </Card>
        ))}

        <SectionHeader title="Contact support" />
        {!token ? (
          <Card style={styles.faq}>
            <Text style={styles.faqA}>Sign in to send a support request and track replies here.</Text>
            <View style={styles.loginGap}>
              <Button label="Sign in" onPress={() => navigation.navigate('Login')} />
            </View>
          </Card>
        ) : (
          <Card style={styles.form}>
            <Input label="Subject" value={subject} onChangeText={setSubject}
              placeholder="e.g. Refund not received" maxLength={120} />
            <Input label="Booking or request ID (optional)" value={bookingRef} onChangeText={setBookingRef}
              placeholder="Paste from Request details" maxLength={40} autoCapitalize="none" />
            <Input label="Describe the issue" value={message} onChangeText={setMessage} multiline
              placeholder="What happened? Include dates and amounts if it is about a payment." maxLength={2000} />
            <Button label="Send support request" loading={file.isPending} loadingLabel="Sending"
              disabled={!valid || file.isPending} onPress={() => file.mutate()} />
          </Card>
        )}
        {token ? (
          <>
            <SectionHeader title="My support requests" />
            {tickets.isPending ? (
              <Card style={styles.faq}><Text style={styles.faqA}>Loading your requests…</Text></Card>
            ) : tickets.isError ? (
              <Card style={styles.faq}>
                <Text style={styles.faqA}>Could not load your requests.</Text>
                <View style={styles.loginGap}>
                  <Button label={tickets.isFetching ? 'Checking…' : 'Try again'} variant="secondary"
                    onPress={() => void tickets.refetch()} />
                </View>
              </Card>
            ) : tickets.data?.length ? tickets.data.map(ticket => {
              const draft = drafts[ticket.id] ?? '';
              const sending = followUp.isPending && replyingTo === ticket.id;
              return (
              <Card key={ticket.id} style={styles.faq}>
                <Text style={styles.faqQ}>{ticket.subject}</Text>
                <Text style={styles.ticketStatus}>{TICKET_STATUS[ticket.status]}</Text>
                <Text style={styles.faqA}>{ticket.message}</Text>
                {ticket.replies ? (
                  <SupportThread replies={ticket.replies} />
                ) : ticket.adminReply ? (
                  <View style={styles.replyBox}>
                    <Text style={styles.replyLabel}>Support reply</Text>
                    <Text style={styles.replyText}>{ticket.adminReply}</Text>
                  </View>
                ) : null}
                <View style={styles.replyRow}>
                  <View style={styles.replyInput}>
                    <Input value={draft} onChangeText={text => setDrafts(current => ({...current, [ticket.id]: text}))}
                      placeholder="Write a follow-up…" maxLength={2000} multiline
                      accessibilityLabel={`Reply to ${ticket.subject}`} />
                  </View>
                  <TouchableOpacity accessibilityRole="button"
                    accessibilityLabel={sending ? 'Sending reply' : `Send reply to ${ticket.subject}`}
                    disabled={draft.trim().length < 2 || sending}
                    onPress={() => { setReplyingTo(ticket.id); followUp.mutate({ticketId: ticket.id, message: draft.trim()}); }}
                    style={[styles.sendButton, (draft.trim().length < 2 || sending) && {opacity: 0.5}]}>
                    <Icon name={ICONS.send} size={18} color={Colors.white} />
                  </TouchableOpacity>
                </View>
              </Card>
              );
            }) : (
              <Card style={styles.faq}><Text style={styles.faqA}>No support requests yet. Replies from the team appear here.</Text></Card>
            )}
          </>
        ) : null}

        <View style={styles.note}>
          <Icon name={ICONS.support} size={14} color={Colors.slate500} />
          <Text style={styles.noteLabel}>
            For job questions, contact your professional through Messages. Use support requests for payments, refunds and account issues.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.offWhite,
  },
  body: {
    padding: Spacing.lg,
  },
  contactRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  contactCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.slate100,
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    gap: Spacing.xs,
  },
  contactIcon: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactLabel: {
    ...Typography.subtitle,
    fontWeight: '700',
    color: Colors.slate900,
  },
  contactSub: {
    ...Typography.caption,
    color: Colors.slate500,
  },
  faq: {
    marginBottom: Spacing.sm,
  },
  form: {
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  loginGap: {
    marginTop: Spacing.sm,
  },
  ticketStatus: {
    ...Typography.badge,
    color: Colors.navyMid,
    fontWeight: '700',
    marginTop: 2,
  },
  replyBox: {
    marginTop: Spacing.sm,
    backgroundColor: Colors.softBlue,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    gap: 2,
  },
  replyLabel: {
    ...Typography.badge,
    fontWeight: '700',
    color: Colors.navyDeep,
  },
  replyText: {
    ...Typography.body,
    color: Colors.slate800,
  },
  replyRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  replyInput: {
    flex: 1,
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.navyDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faqHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  faqQ: {
    ...Typography.subtitle,
    fontWeight: '600',
    color: Colors.slate800,
    flex: 1,
  },
  faqOpen: {
    transform: [{rotate: '180deg'}],
  },
  faqA: {
    ...Typography.body,
    color: Colors.slate600,
    marginTop: Spacing.sm,
  },
  note: {
    flexDirection: 'row',
    gap: Spacing.xs,
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  noteLabel: {
    ...Typography.badge,
    color: Colors.slate500,
    flex: 1,
  },
});
