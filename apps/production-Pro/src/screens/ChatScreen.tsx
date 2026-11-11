import {ScreenHeader} from '../components/ScreenHeader';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  AppState,
  FlatList,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {KeyboardAwareView} from '../../../../packages/mobile-ui/KeyboardAwareView';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {useNavigation, useRoute} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import type {BottomTabNavigationProp} from '@react-navigation/bottom-tabs';
import {useBottomTabBarHeight} from '@react-navigation/bottom-tabs';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from '@nahtreek/design-system';
import type {MainTabParamList, MessagesStackParamList} from '../navigation/types';
import {api} from '../services/apiClient';
import {openChatSocket} from '../services/chatSocket';
import {useSessionStore} from '../stores/session';
import {useProToast} from '../stores/proToast';
import {EmptyState} from '../components/EmptyState';
import {ScreenLoading} from '../components/ScreenLoading';
import {JobContextVisual} from '../components/JobContextVisual';

type Props = NativeStackScreenProps<MessagesStackParamList, 'Chat'>;
type Message = {
  id: string;
  conversationId: string;
  senderUserId: string;
  senderName: string;
  content: string;
  createdAt: string;
};
// Delivery truth the client actually knows: a message is sending until the
// server accepts it, then sent. Delivered/read ticks would be faked — the
// server sends no receipt events — so sent is the final honest state.
type LocalMessage = Message & {status?: 'sending' | 'sent' | 'failed'};

type FeedItem =
  | {kind: 'day'; key: string; label: string}
  | {kind: 'message'; key: string; message: LocalMessage; mine: boolean; showSender: boolean};

const QUICK_REPLIES = ['On my way', 'I will reach in 15 minutes', 'I will share photos of the work'];

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-IN', {day: 'numeric', month: 'short', year: 'numeric'});
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {hour: 'numeric', minute: '2-digit'});
}

export function ChatScreen() {
  const insets = useSafeAreaInsets();
  const route = useRoute<Props['route']>();
  const navigation =
    useNavigation<NativeStackNavigationProp<MessagesStackParamList>>();
  const queryClient = useQueryClient();
  const toast = useProToast();
  const currentUser = useSessionStore(state => state.user);
  const accessToken = useSessionStore(state => state.accessToken);
  const {conversationId, title, subtitle, avatarUrl, requestId, requestKind, threads} = route.params;
  const jobLabel = (value?: string) => (value ?? 'Job').replace(/^Re:\s*/, '');
  // Two jobs can share a title ("Wall crack" twice) — the status suffix keeps
  // the thread chips distinguishable.
  const SHORT_STATUS: Record<string, string> = {COMPLETED: 'Done', IN_PROGRESS: 'Live',
    ACCEPTED: 'Accepted', PENDING: 'Pending', ARRIVED: 'Arrived', EN_ROUTE: 'On the way'};
  const threadLabel = (thread: NonNullable<typeof threads>[number]) => {
    const job = jobLabel(thread.subtitle);
    const raw = thread.requestStatus;
    if (!raw) return job;
    const short = SHORT_STATUS[raw] ?? raw.replace(/_/g, ' ').toLowerCase().replace(/^./, (c: string) => c.toUpperCase());
    return `${job} \u00B7 ${short}`;
  };
  const switchThread = (thread: NonNullable<typeof threads>[number]) => {
    if (thread.conversationId === conversationId || sending.current) return;
    // Never carry a half-typed message into another job's thread.
    setDraft('');
    setShowJumpPill(false);
    navigation.setParams({
      conversationId: thread.conversationId,
      title: thread.title,
      subtitle: thread.subtitle,
      avatarUrl: thread.avatarUrl,
      requestId: thread.requestId,
      requestKind: thread.requestKind,
      threads,
    });
  };
  const [draft, setDraft] = useState('');
  const [connected, setConnected] = useState(true);
  const [showJumpPill, setShowJumpPill] = useState(false);
  // The floating tab bar hides with the keyboard but overlays the composer
  // when it is closed — keep the composer and latest message above it.
  const tabBarHeight = useBottomTabBarHeight();
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const barClearance = keyboardVisible ? 0 : tabBarHeight;
  const listRef = useRef<FlatList<FeedItem>>(null);
  const sending = useRef(false);
  const messages = useQuery({
    queryKey: ['professional-messages', conversationId],
    queryFn: () =>
      api.get<Message[]>(`/conversations/${conversationId}/messages`),
    // The socket pushes live messages; polling is only the offline fallback.
    refetchInterval: connected ? false : 5000,
    refetchIntervalInBackground: false,
  });

  const upsertLocal = (message: LocalMessage) => {
    queryClient.setQueryData<LocalMessage[]>(
      ['professional-messages', conversationId],
      (previous: LocalMessage[] | undefined) =>
        [
          ...(previous ?? []).filter((item: LocalMessage) => item.id !== message.id),
          message,
        ].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
  };

  const send = useMutation({
    mutationFn: async ({content, localId}: {content: string; localId: string}) => {
      const message = await api.post<Message>(`/conversations/${conversationId}/messages`, {content});
      return {message, localId};
    },
    onSuccess: ({message, localId}) => {
      queryClient.setQueryData<LocalMessage[]>(
        ['professional-messages', conversationId],
        (previous: LocalMessage[] | undefined) =>
          [
            ...(previous ?? []).filter((item: LocalMessage) => item.id !== message.id && item.id !== localId),
            {...message, status: 'sent'},
          ].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      );
      queryClient
        .invalidateQueries({queryKey: ['professional-conversations']})
        .catch(() => undefined);
    },
    onError: (error, {localId}) => {
      queryClient.setQueryData<LocalMessage[]>(
        ['professional-messages', conversationId],
        (previous: LocalMessage[] | undefined) =>
          (previous ?? []).map((item: LocalMessage) =>
            item.id === localId ? {...item, status: 'failed'} : item,
          ),
      );
      toast(error instanceof Error ? error.message : 'Message failed to send.', 'error');
    },
    onSettled: () => {
      sending.current = false;
    },
  });

  useEffect(() => {
    api
      .patch(`/conversations/${conversationId}/read`)
      .then(() =>
        queryClient.invalidateQueries({
          queryKey: ['professional-conversations'],
        }),
      )
      .catch(() => undefined);
  }, [conversationId, queryClient]);
  useEffect(() => {
    if (!accessToken) {
      return;
    }
    const socket = openChatSocket(accessToken);
    if (!socket) {
      setConnected(false);
      return;
    }
    const refresh = () => {
      setConnected(true);
      socket.emit('conversation:join', {conversationId});
      queryClient
        .invalidateQueries({
          queryKey: ['professional-messages', conversationId],
        })
        .catch(() => undefined);
    };
    const receive = (message: Message) => {
      if (message.conversationId !== conversationId) {
        return;
      }
      queryClient.setQueryData<LocalMessage[]>(
        ['professional-messages', conversationId],
        (previous: LocalMessage[] | undefined) =>
          [
            ...(previous ?? []).filter((item: LocalMessage) => item.id !== message.id),
            {...message, status: 'sent'},
          ].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      );
      queryClient
        .invalidateQueries({queryKey: ['professional-conversations']})
        .catch(() => undefined);
    };
    const markOffline = () => setConnected(false);
    socket.on('connect', refresh);
    socket.on('disconnect', markOffline);
    socket.on('message:created', receive);
    const appState = AppState.addEventListener('change', state =>
      state === 'active' ? socket.connect() : socket.disconnect(),
    );
    return () => {
      appState.remove();
      socket.off('connect', refresh);
      socket.off('disconnect', markOffline);
      socket.off('message:created', receive);
      socket.disconnect();
    };
  }, [accessToken, conversationId, queryClient]);

  const submit = (raw: string) => {
    const content = raw.trim();
    if (!content || sending.current) {
      return;
    }
    sending.current = true;
    const localId = `local-${Date.now()}`;
    upsertLocal({
      id: localId,
      conversationId,
      senderUserId: currentUser?.id ?? 'me',
      senderName: currentUser?.fullName ?? 'You',
      content,
      createdAt: new Date().toISOString(),
      status: 'sending',
    });
    setDraft(current => (current.trim() === content ? '' : current));
    send.mutate({content, localId});
  };

  const feed = useMemo<FeedItem[]>(() => {
    const sorted = [...((messages.data ?? []) as LocalMessage[])].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    const items: FeedItem[] = [];
    let lastDay = '';
    let lastSender = '';
    for (const message of sorted) {
      const day = new Date(message.createdAt).toDateString();
      if (day !== lastDay) {
        lastDay = day;
        lastSender = '';
        items.push({kind: 'day', key: `day-${day}`, label: dayLabel(message.createdAt)});
      }
      const mine = message.senderUserId === currentUser?.id;
      const showSender = !mine && message.senderUserId !== lastSender;
      lastSender = message.senderUserId;
      items.push({kind: 'message', key: message.id, message, mine, showSender});
    }
    return items;
  }, [messages.data, currentUser?.id]);

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={title}
        subtitle={subtitle}
        avatarUrl={avatarUrl}
        onBack={() => navigation.goBack()}
      />
      {threads && threads.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.threadScroller} contentContainerStyle={styles.threadRow}>
        {threads.map(thread => {
          const selected = thread.conversationId === conversationId;
          return (
            <Pressable
              key={thread.conversationId}
              accessibilityRole="button"
              accessibilityLabel={`Open ${threadLabel(thread)} chat`}
              accessibilityState={{selected}}
              onPress={() => switchThread(thread)}
              style={[styles.threadChip, selected && styles.threadChipOn]}>
              <Text style={[styles.threadText, selected && styles.threadTextOn]} numberOfLines={1}>{threadLabel(thread)}</Text>
            </Pressable>
          );
        })}
      </ScrollView> : null}
      {requestId && requestKind ? <Pressable accessibilityRole="button" accessibilityLabel={`View related ${requestKind === 'service' ? 'service job' : 'engineering request'}`} onPress={() => navigation.getParent<BottomTabNavigationProp<MainTabParamList>>()?.navigate('Requests', {screen: 'RequestDetail', params: {id: requestId, kind: requestKind}})} style={styles.jobContext}>
        <JobContextVisual kind={requestKind} title={title} seed={requestId} size={40} />
        <Text style={styles.jobContextText} numberOfLines={1}>{subtitle || 'Related job'}</Text>
        <Text style={styles.jobContextAction}>View job  →</Text>
      </Pressable> : null}
      {!connected ? <View style={styles.offlineBar}>
        <MaterialCommunityIcons name="wifi-off" size={15} color={Colors.white} />
        <Text style={styles.offlineText}>Reconnecting — new messages may be delayed</Text>
      </View> : null}
      <KeyboardAwareView style={styles.flex}>
        {messages.isPending ? (
          <ScreenLoading label="Loading conversation…" rows={4} />
        ) : messages.isError ? (
          <View style={styles.errorWrap}>
            <EmptyState
              icon="cloud-off-outline"
              title="Conversation could not load"
              message="Check your connection and try again."
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Retry loading messages" onPress={() => messages.refetch()} style={styles.retry}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : feed.length ? (
          <View style={styles.flex}>
            <FlatList
              ref={listRef}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              data={feed}
              keyExtractor={item => item.key}
              contentContainerStyle={styles.list}
              ListFooterComponent={<View style={{height: barClearance}} />}
              onContentSizeChange={() => listRef.current?.scrollToEnd({animated: false})}
              onScroll={event => {
                const {contentOffset, layoutMeasurement, contentSize} = event.nativeEvent;
                setShowJumpPill(contentSize.height - contentOffset.y - layoutMeasurement.height > 300);
              }}
              scrollEventThrottle={200}
              renderItem={({item}) => {
                if (item.kind === 'day') {
                  return (
                    <View style={styles.dayWrap}>
                      <Text style={styles.day}>{item.label}</Text>
                    </View>
                  );
                }
                const {message, mine, showSender} = item;
                const failed = message.status === 'failed';
                return (
                  <View
                    style={[styles.bubbleWrap, mine && styles.bubbleWrapMine]}>
                    <View style={[styles.bubble, mine && styles.bubbleMine, failed && styles.bubbleFailed]}>
                      {showSender ? (
                        <Text style={styles.sender}>{message.senderName}</Text>
                      ) : null}
                      <Text style={[styles.message, mine && styles.messageMine]}>
                        {message.content}
                      </Text>
                      <View style={styles.metaRow}>
                        <Text style={[styles.time, mine && styles.timeMine]}>
                          {timeLabel(message.createdAt)}
                        </Text>
                        {mine ? message.status === 'sending' ? (
                          <MaterialCommunityIcons name="clock-outline" size={13} color={Colors.slate300} />
                        ) : failed ? (
                          <MaterialCommunityIcons name="alert-circle-outline" size={14} color={Colors.error} />
                        ) : (
                          <MaterialCommunityIcons name="check" size={15} color={Colors.slate300} />
                        ) : null}
                      </View>
                      {failed ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Retry sending message"
                          onPress={() => {
                            queryClient.setQueryData<LocalMessage[]>(
                              ['professional-messages', conversationId],
                              (previous: LocalMessage[] | undefined) =>
                                (previous ?? []).filter((entry: LocalMessage) => entry.id !== message.id),
                            );
                            submit(message.content);
                          }}
                          style={styles.retryBubble}>
                          <Text style={styles.retryBubbleText}>Tap to retry</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                );
              }}
            />
            {showJumpPill ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Jump to latest messages"
                onPress={() => listRef.current?.scrollToEnd({animated: true})}
                style={styles.jumpPill}>
                <MaterialCommunityIcons name="chevron-down" size={20} color={Colors.white} />
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={styles.empty}>
            <EmptyState
              icon="message-outline"
              title="No messages yet"
              message="Send a clear message about this job to get started."
            />
            <View style={styles.quickRow}>
              {QUICK_REPLIES.map(reply => (
                <Pressable
                  key={reply}
                  accessibilityRole="button"
                  accessibilityLabel={`Use quick reply: ${reply}`}
                  onPress={() => setDraft(reply)}
                  style={styles.quickReply}>
                  <Text style={styles.quickReplyText}>{reply}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
        <View
          style={[
            styles.composer,
            {paddingBottom: Math.max(insets.bottom, 20) + barClearance},
          ]}>
          <TextInput
            accessibilityLabel="Message"
            value={draft}
            onChangeText={setDraft}
            multiline
            placeholder="Write a message"
            placeholderTextColor={Colors.slate500}
            style={styles.input}
          />
          <Pressable
            accessibilityLabel={
              send.isPending ? 'Sending message' : 'Send message'
            }
            disabled={!draft.trim() || send.isPending}
            onPress={() => submit(draft)}
            style={[
              styles.send,
              (!draft.trim() || send.isPending) && styles.sendDisabled,
            ]}>
            <MaterialCommunityIcons
              name="send"
              size={18}
              color={Colors.white}
            />
          </Pressable>
        </View>
      </KeyboardAwareView>
    </View>
  );
}

const styles = StyleSheet.create({
  threadScroller: {flexGrow: 0, flexShrink: 0},
  threadRow: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.slate200},
  threadChip: {maxWidth: 180, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: Colors.offWhite, borderWidth: 1, borderColor: Colors.slate200},
  threadChipOn: {backgroundColor: Colors.navyDeep, borderColor: Colors.navyDeep},
  threadText: {...Typography.caption, fontWeight: '700', color: Colors.navyMid},
  threadTextOn: {color: Colors.white},
  jobContext: {flexShrink: 0, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.slate200, backgroundColor: Colors.white},
  jobContextText: {...Typography.caption, color: Colors.slate800, flex: 1},
  jobContextAction: {...Typography.caption, fontWeight: '700', color: Colors.navyMid},
  offlineBar: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 7, backgroundColor: Colors.navyDeep},
  offlineText: {...Typography.caption, color: Colors.white},
  root: {flex: 1, backgroundColor: Colors.offWhite},
  flex: {flex: 1, minWidth: 0},
  list: {padding: 16},
  dayWrap: {alignItems: 'center', marginVertical: 10},
  day: {...Typography.badge, lineHeight: 16, color: Colors.slate600, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.slate200, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, overflow: 'hidden'},
  bubbleWrap: {alignItems: 'flex-start', marginBottom: 6},
  bubbleWrapMine: {alignItems: 'flex-end'},
  bubble: {
    maxWidth: '85%',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.slate200,
    borderRadius: BorderRadius.lg,
    borderBottomLeftRadius: BorderRadius.xs,
  },
  bubbleMine: {
    backgroundColor: Colors.navyDeep,
    borderColor: Colors.navyDeep,
    borderBottomLeftRadius: BorderRadius.lg,
    borderBottomRightRadius: BorderRadius.xs,
  },
  bubbleFailed: {borderColor: Colors.error},
  sender: {
    ...Typography.badge,
    lineHeight: 16,
    color: Colors.navyMid,
    marginBottom: 2,
  },
  message: {...Typography.body, color: Colors.slate800},
  messageMine: {color: Colors.white},
  metaRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 3},
  time: {
    ...Typography.badge,
    lineHeight: 16,
    color: Colors.slate500,
    textAlign: 'right',
  },
  timeMine: {color: Colors.slate300},
  retryBubble: {marginTop: 4, alignSelf: 'flex-end'},
  retryBubbleText: {...Typography.badge, lineHeight: 16, fontWeight: '700', color: Colors.error},
  empty: {flex: 1, justifyContent: 'center', padding: 20, gap: 12},
  quickRow: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8},
  quickReply: {paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.navyMid},
  quickReplyText: {...Typography.caption, fontWeight: '700', color: Colors.navyMid},
  errorWrap: {flex: 1, justifyContent: 'center', padding: 20},
  retry: {alignSelf: 'center', padding: 20},
  retryText: {...Typography.button, lineHeight: 22, color: Colors.navyMid},
  jumpPill: {position: 'absolute', right: 16, bottom: 12, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.navyDeep, elevation: 4, shadowColor: Colors.navyDeep, shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: {width: 0, height: 2}},
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    padding: 16,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.slate200,
  },
  input: {
    ...Typography.body,
    flex: 1,
    maxHeight: 112,
    minHeight: 48,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    color: Colors.slate900,
    backgroundColor: Colors.offWhite,
    borderWidth: 1,
    borderColor: Colors.slate200,
    borderRadius: BorderRadius.lg,
  },
  send: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: Colors.navyDeep,
  },
  sendDisabled: {opacity: 0.45},
});
