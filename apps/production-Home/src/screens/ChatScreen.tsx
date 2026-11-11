import React, {useEffect, useState, useRef} from 'react';
import {View, Text, FlatList, TouchableOpacity, StyleSheet, Keyboard, AppState} from 'react-native';
import {KeyboardAwareView} from '../../../../packages/mobile-ui/KeyboardAwareView';
import {useNavigation, useRoute, RouteProp} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Colors, Typography, Spacing, BorderRadius} from '@nahtreek/design-system';
import {AppHeader, Avatar, Icon, ICONS, Input, OfflineBanner} from '../components/ui';
import {useMarkConversationRead} from '../services/queries';
import {useToast} from '../stores/toast';
import {EmptyState, ErrorState, ICONS as UICONS} from '../components/ui';
import {useMessagesList, useSendMessage} from '../services/queries';
import {openChatSocket} from '../services/chatSocket';
import type {MessageDto} from '@nahtreek/types';
import type {RootStackParamList} from '../navigation/types';
import {useSessionStore} from '../stores/session';
import {useQueryClient} from '@tanstack/react-query';
import {queryKeys} from '../services/queries';
import {isApiConfigured} from '../services/config';
import {ClientColors} from '../design-system/tokens';

type ChatRoute = RouteProp<RootStackParamList, 'Chat'>;

export function ChatScreen() {
  const navigation = useNavigation();
  const route = useRoute<ChatRoute>();
  const insets = useSafeAreaInsets();
  const {conversationId, title, subtitle, avatarUrl} = route.params;
  const client = useQueryClient();
  const pending = useRef(false);
  const listRef = useRef<FlatList>(null);
  const [draft, setDraft] = useState('');
  const msgsQuery = useMessagesList(conversationId);
  const messages = msgsQuery.data ?? [];
  const sendMut = useSendMessage();
  const markRead = useMarkConversationRead();
  const toast = useToast();
  const currentUser = useSessionStore(state => state.user);
  const accessToken = useSessionStore(state => state.accessToken);

  useEffect(() => {
    markRead.mutate(conversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    listRef.current?.scrollToEnd({animated: messages.length > 0});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, conversationId]);

  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () =>
      listRef.current?.scrollToEnd({animated: true}),
    );
    return () => shown.remove();
  }, []);

  useEffect(() => {
    if (!accessToken) return;
    const socket = openChatSocket(accessToken);
    if (!socket) return;
    const onMessage = (message: MessageDto) => {
      if (message.conversationId !== conversationId) return;
      client.setQueryData<MessageDto[]>(queryKeys.messages(conversationId), (previous: MessageDto[] | undefined) =>
        [...(previous ?? []).filter((item: MessageDto) => item.id !== message.id), message]
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      void client.invalidateQueries({queryKey: queryKeys.conversations});
    };
    const reconnect = () => {
      socket.emit('conversation:join', {conversationId});
      void client.invalidateQueries({queryKey: queryKeys.messages(conversationId)});
    };
    socket.on('connect', reconnect);
    socket.on('message:created', onMessage);
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') socket.connect();
      else socket.disconnect();
    });
    return () => {
      appState.remove();
      socket.off('connect', reconnect);
      socket.off('message:created', onMessage);
      socket.disconnect();
    };
  }, [accessToken, conversationId, client]);

  const send = () => {
    const content = draft.trim();
    if (!content || pending.current) return;
    pending.current = true;
    // Optimistic bubble: the message appears instantly with a local id; the
    // server echo (or socket event) replaces it by id, and a failure pulls
    // it back out while restoring the draft for retry. Same pattern as the
    // Pro chat — ids make double-apply impossible.
    const localId = `local-${Date.now()}`;
    const optimistic: MessageDto = {id: localId, conversationId,
      senderUserId: currentUser?.id ?? 'me', senderName: currentUser?.fullName ?? 'You',
      content, createdAt: new Date().toISOString()};
    client.setQueryData<MessageDto[]>(queryKeys.messages(conversationId), (previous: MessageDto[] | undefined) =>
      [...(previous ?? []), optimistic].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    setDraft(current => current.trim() === content ? '' : current);
    sendMut.mutate({conversationId, content}, {
      onSuccess: message => {
        client.setQueryData<MessageDto[]>(queryKeys.messages(conversationId), (previous: MessageDto[] | undefined) =>
          [...(previous ?? []).filter((item: MessageDto) => item.id !== message.id && item.id !== localId), message]
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      },
      onError: () => {
        client.setQueryData<MessageDto[]>(queryKeys.messages(conversationId), (previous: MessageDto[] | undefined) =>
          (previous ?? []).filter((item: MessageDto) => item.id !== localId));
        setDraft(current => (current ? current : content));
        toast('Message not sent. Your text is kept below; tap Send to retry.', 'error');
      },
      onSettled: () => { pending.current = false; },
    });
  };

  return (
    <View style={[styles.container, {paddingBottom: insets.bottom}]}>
      <AppHeader title={title} subtitle={subtitle} onBack={() => navigation.goBack()}
        left={<Avatar name={title} uri={avatarUrl} size={36} />} />

      <OfflineBanner
        force={!isApiConfigured}
        title="Offline conversation"
        message="Connect to the internet to send messages. Unsent text remains in the composer."
      />

      <KeyboardAwareView style={styles.flex}>
        {msgsQuery.isLoading && messages.length === 0 ? (
          <EmptyState icon={UICONS.messages} title="Loading conversation" message="Fetching your messages..." />
        ) : msgsQuery.isError && messages.length === 0 ? (
          <ErrorState icon={UICONS.messages} title="Couldn't load messages" message="Check your connection and try again." actionLabel="Retry" onAction={() => msgsQuery.refetch()} />
        ) : messages.length === 0 ? (
          <EmptyState icon={UICONS.messages} title="No messages yet" message="Say hello to start the conversation." />
        ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onContentSizeChange={() => listRef.current?.scrollToEnd({animated: false})}
          onLayout={() => listRef.current?.scrollToEnd({animated: false})}
          renderItem={({item}) => {
            const mine = item.senderUserId === currentUser?.id;
            return (
              <View style={[styles.bubbleWrap, mine && styles.bubbleWrapMine]}>
                <View style={[styles.bubble, mine && styles.bubbleMine]}>
                  <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>
                    {item.content}
                  </Text>
                  <Text style={[styles.time, mine && styles.timeMine]}>
                    {new Date(item.createdAt).toLocaleTimeString('en-IN', {hour: 'numeric', minute: '2-digit'})}
                  </Text>
                </View>
              </View>
            );
          }}
        />
        )}
        {sendMut.isPending ? <Text accessibilityRole="alert" style={{paddingHorizontal: 24, color: Colors.slate600}}>Sending…</Text> : null}
        <View style={styles.inputBar}>
          <View style={styles.inputWrap}>
            <Input value={draft} onChangeText={setDraft} placeholder="Write a message..." multiline style={styles.input} inputStyle={styles.inputText} />
          </View>
          <TouchableOpacity style={[styles.send, (sendMut.isPending || !draft.trim()) && {opacity: 0.5}]} onPress={send} disabled={sendMut.isPending || !draft.trim()} accessibilityLabel={sendMut.isPending ? "Sending message" : "Send message"} accessibilityRole="button">
            <Icon name={ICONS.send} size={18} color={Colors.white} />
          </TouchableOpacity>
        </View>
      </KeyboardAwareView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ClientColors.lightBackground,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.navyDeep,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.overlayLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titles: {
    flex: 1,
  },
  title: {
    ...Typography.subtitle,
    fontWeight: '700',
    color: Colors.white,
  },
  subtitle: {
    ...Typography.badge,
    color: Colors.slate300,
    marginTop: 1,
  },
  list: {
    padding: 20,
  },
  bubbleWrap: {
    alignItems: 'flex-start',
    marginBottom: Spacing.md,
  },
  bubbleWrapMine: {
    alignItems: 'flex-end',
  },
  bubble: {
    maxWidth: '88%',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderBottomLeftRadius: BorderRadius.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderWidth: 1,
    borderColor: Colors.slate100,
  },
  bubbleMine: {
    backgroundColor: Colors.navyDeep,
    borderBottomLeftRadius: BorderRadius.lg,
    borderBottomRightRadius: BorderRadius.xs,
    borderColor: Colors.navyDeep,
  },
  bubbleText: {
    ...Typography.body,
    color: Colors.slate800,
  },
  bubbleTextMine: {
    color: Colors.white,
  },
  time: {
    ...Typography.badge,
    color: Colors.slate400,
    marginTop: 4,
    textAlign: 'right',
  },
  timeMine: {
    color: Colors.slate300,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.slate100,
  },
  inputWrap: {
    flex: 1,
  },
  input: {
    marginBottom: 0,
  },
  inputText: {
    minHeight: 48,
  },
  send: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: Colors.navyDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
