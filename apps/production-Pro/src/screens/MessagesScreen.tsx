import React, {useEffect, useMemo, useState} from 'react';
import {
  Animated,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {BottomTabNavigationProp} from '@react-navigation/bottom-tabs';
import {useBottomTabBarHeight} from '@react-navigation/bottom-tabs';
import {useQuery} from '@tanstack/react-query';
import {
  Colors,
  Spacing,
  Typography,
} from '@nahtreek/design-system';
import {ScreenHeader} from '../components/ScreenHeader';
import {EmptyState} from '../components/EmptyState';
import {VerificationGate} from '../components/VerificationGate';
import {api} from '../services/apiClient';
import {mediaUrl} from '../services/media';
import type {MainTabParamList, MessagesStackParamList} from '../navigation/types';
import {ProColors} from '../theme/professionalTheme';
import {ScreenLoading} from '../components/ScreenLoading';
import {MotionReveal} from '../components/MotionReveal';
import {ScrollMotionBar, useScrollMotion} from '../components/ScrollMotionBar';

type Conversation = {
  id: string;
  otherUserId?: string;
  title: string;
  subtitle: string;
  otherAvatarUrl?: string;
  lastMessage: string;
  lastAt: string;
  unread: number;
  requestId?: string;
  requestKind?: 'engineering' | 'service';
  requestStatus?: string;
};
type ConversationPage = {data: Conversation[]; meta: {total: number}};

type PersonGroup = {
  key: string;
  title: string;
  avatarUrl?: string;
  threads: Conversation[];
  latest: Conversation;
  unreadTotal: number;
};

// One row per person: the server keeps one thread per job, but the pro sees
// a single chat per customer and flips between that customer's jobs inside.
// Groups by the server's otherUserId when present, else by name+photo.
function groupByPerson(items: Conversation[]): PersonGroup[] {
  const groups = new Map<string, Conversation[]>();
  for (const item of items) {
    const key = item.otherUserId ? `id:${item.otherUserId}` : `name:${item.title}::${item.otherAvatarUrl ?? ''}`;
    const existing = groups.get(key) ?? [];
    existing.push(item);
    groups.set(key, existing);
  }
  return [...groups.entries()].map(([key, threads]) => {
    const sorted = [...threads].sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));
    return {
      key,
      title: sorted[0].title,
      avatarUrl: sorted[0].otherAvatarUrl,
      threads: sorted,
      latest: sorted[0],
      unreadTotal: sorted.reduce((sum, thread) => sum + Math.max(0, thread.unread), 0),
    };
  }).sort((a, b) => Date.parse(b.latest.lastAt) - Date.parse(a.latest.lastAt));
}

function ConversationAvatar({title, url}: {title: string; url?: string}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (url && !failed) {
    return <Image source={{uri: mediaUrl(url)}} style={styles.avatarPhoto} onError={() => setFailed(true)} />;
  }
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{title.charAt(0).toUpperCase() || 'C'}</Text>
    </View>
  );
}

export function MessagesScreen() {
  const tabBarHeight = useBottomTabBarHeight();
  const scrollMotion = useScrollMotion();
  const navigation =
    useNavigation<NativeStackNavigationProp<MessagesStackParamList>>();
  const tabs = navigation.getParent<BottomTabNavigationProp<MainTabParamList>>();
  const conversations = useQuery({
    queryKey: ['professional-conversations'],
    queryFn: () => api.get<ConversationPage>('/conversations?limit=50'),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const profile = useQuery({
    queryKey: ['professional-profile'],
    queryFn: () => api.get<{profile: {verificationStatus: string} | null}>('/professionals/me'),
  });
  const verificationStatus = profile.data?.profile?.verificationStatus;
  const locked = Boolean(profile.data) && verificationStatus !== 'VERIFIED';
  const underReview = verificationStatus === 'UNDER_REVIEW' || verificationStatus === 'PENDING';
  const [search, setSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const groups = useMemo(() => {
    const all = groupByPerson(conversations.data?.data ?? []);
    const term = search.trim().toLowerCase();
    return all.filter(group => {
      if (unreadOnly && group.unreadTotal === 0) return false;
      if (!term) return true;
      return group.title.toLowerCase().includes(term)
        || group.latest.lastMessage.toLowerCase().includes(term)
        || group.threads.some(thread => thread.subtitle.toLowerCase().includes(term));
    });
  }, [conversations.data, search, unreadOnly]);
  const goVerify = () =>
    tabs?.navigate('Profile', {
      screen:
        verificationStatus === 'UNDER_REVIEW' ||
        verificationStatus === 'PENDING' ||
        verificationStatus === 'REJECTED'
          ? 'VerificationDocuments'
          : 'ProfessionalSetup',
    });
  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Chat"
        subtitle="Talk to your customers"
      />
      <ScrollMotionBar offset={scrollMotion.offset} reducedMotion={scrollMotion.reducedMotion} />
      {locked ? (
        <VerificationGate
          feature="chat"
          underReview={underReview}
          onVerify={goVerify}
          bottomPadding={tabBarHeight + 24}
        />
      ) : (
      <>
      {conversations.isPending ? (
        <ScreenLoading label="Loading client conversations…" />
      ) : null}
      {conversations.isError ? (
        <View style={styles.content}>
          <EmptyState
            icon="cloud-off-outline"
            title="Messages could not load"
            message="Check your connection and try again."
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading conversations"
            onPress={() => conversations.refetch()}
            style={styles.retry}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
      {conversations.data ? (
        <MotionReveal style={styles.listContainer}>
        <View style={styles.tools}>
          <View style={styles.searchBox}>
            <MaterialCommunityIcons name="magnify" size={20} color={Colors.slate500} />
            <TextInput
              accessibilityLabel="Search chats"
              value={search}
              onChangeText={setSearch}
              placeholder="Search people or jobs"
              placeholderTextColor={Colors.slate500}
              style={styles.searchInput}
            />
            {search ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearch('')} style={styles.searchClear}>
              <MaterialCommunityIcons name="close-circle" size={18} color={Colors.slate500} />
            </Pressable> : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={unreadOnly ? 'Show all chats' : 'Show unread chats only'}
            accessibilityState={{selected: unreadOnly}}
            onPress={() => setUnreadOnly(value => !value)}
            style={[styles.unreadChip, unreadOnly && styles.unreadChipOn]}>
            <Text style={[styles.unreadChipText, unreadOnly && styles.unreadChipTextOn]}>Unread</Text>
          </Pressable>
        </View>
        <Animated.FlatList
          onScroll={scrollMotion.onScroll}
          scrollEventThrottle={16}
          data={groups}
          keyExtractor={item => item.key}
          contentContainerStyle={[styles.list, {paddingBottom: tabBarHeight + Spacing.xxl}]}
          refreshControl={
            <RefreshControl
              refreshing={conversations.isRefetching}
              onRefresh={conversations.refetch}
              colors={[Colors.navyMid]}
            />
          }
          ListEmptyComponent={<View style={styles.emptyCard}>
            <View style={styles.emptyIcon}><MaterialCommunityIcons name="message-text-outline" size={27} color={Colors.navyMid} /></View>
            <Text style={styles.emptyTitle}>{search || unreadOnly ? 'No chats match' : 'Conversations start with a job'}</Text>
            <Text style={styles.emptyText}>{search || unreadOnly ? 'Try a different search or clear the unread filter.' : 'When you take a job, your chat with the customer will show here.'}</Text>
            {search || unreadOnly ? (
              <Pressable accessibilityRole="button" onPress={() => {setSearch(''); setUnreadOnly(false);}} style={styles.emptyAction}>
                <Text style={styles.emptyActionText}>Clear search</Text>
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button" onPress={() => tabs?.navigate('Requests', {screen: 'RequestInbox'})} style={styles.emptyAction}>
                <Text style={styles.emptyActionText}>View my jobs</Text>
                <MaterialCommunityIcons name="arrow-right" size={18} color={ProColors.onAccent} />
              </Pressable>
            )}
          </View>}
          renderItem={({item}) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.title}, ${item.threads.length === 1 ? '1 job' : `${item.threads.length} jobs`}${item.unreadTotal > 0 ? `, ${item.unreadTotal} unread` : ''}`}
              onPress={() =>
                navigation.navigate('Chat', {
                  conversationId: item.latest.id,
                  title: item.title,
                  subtitle: item.latest.subtitle,
                  avatarUrl: item.avatarUrl,
                  requestId: item.latest.requestId,
                  requestKind: item.latest.requestKind,
                  threads: item.threads.map(thread => ({
                    conversationId: thread.id,
                    title: item.title,
                    subtitle: thread.subtitle,
                    avatarUrl: item.avatarUrl,
                    requestId: thread.requestId,
                    requestKind: thread.requestKind,
                    requestStatus: thread.requestStatus,
                  })),
                })
              }
              style={({pressed}) => [styles.card, pressed && styles.pressed]}>
              <ConversationAvatar title={item.title} url={item.avatarUrl} />
              <View style={styles.flex}>
                <View style={styles.top}>
                  <Text style={styles.name} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.time}>
                    {new Date(item.latest.lastAt).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                    })}
                  </Text>
                </View>
                <View style={styles.subRow}>
                  <Text style={styles.subtitle} numberOfLines={1}>{item.latest.subtitle}</Text>
                  {item.threads.length > 1 ? (
                    <View style={styles.jobsPill}>
                      <Text style={styles.jobsPillText}>{item.threads.length} jobs</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.top}>
                  <Text style={styles.last} numberOfLines={2}>{item.latest.lastMessage}</Text>
                  {item.unreadTotal > 0 ? (
                    <View style={styles.unread}>
                      <Text style={styles.unreadText}>{item.unreadTotal}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </Pressable>
          )}
        />
        </MotionReveal>
      ) : null}
      </>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: Colors.offWhite},
  listContainer: {flex: 1},
  content: {padding: 20},
  retry: {alignSelf: 'center', padding: 20},
  retryText: {...Typography.button, lineHeight: 22, color: Colors.navyMid},
  list: {padding: 20, paddingBottom: Spacing.xxl, gap: Spacing.sm, flexGrow: 1},
  tools: {flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: 20, paddingTop: 12},
  searchBox: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 14, borderRadius: 14, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.slate200},
  searchInput: {...Typography.body, flex: 1, color: Colors.slate900, paddingVertical: 10},
  searchClear: {padding: 4},
  unreadChip: {minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderRadius: 14, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.slate200},
  unreadChipOn: {backgroundColor: Colors.navyDeep, borderColor: Colors.navyDeep},
  unreadChipText: {...Typography.button, lineHeight: 22, color: Colors.navyMid},
  unreadChipTextOn: {color: Colors.white},
  subRow: {flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2},
  jobsPill: {paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: Colors.navyDeep},
  jobsPillText: {fontSize: 11, fontWeight: '700', color: Colors.white},
  emptyCard: {backgroundColor: Colors.white, borderRadius: 22, borderWidth: 1, borderColor: Colors.slate200, padding: 22, gap: 10, marginTop: Spacing.sm},
  emptyIcon: {width: 52, height: 52, alignItems: 'center', justifyContent: 'center', marginBottom: 6},
  emptyTitle: {...Typography.h2, color: Colors.navyDeep},
  emptyText: {...Typography.body, color: Colors.slate600},
  emptyAction: {minHeight: 48, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16, borderRadius: 12, backgroundColor: ProColors.accent, marginTop: 8},
  emptyActionText: {...Typography.button, color: ProColors.onAccent},
  card: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: ProColors.border,
  },
  pressed: {opacity: 0.82},
  avatar: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 23,
    backgroundColor: Colors.navyMid,
  },
  avatarText: {...Typography.h3, color: Colors.white},
  avatarPhoto: {width: 46, height: 46, borderRadius: 23, backgroundColor: Colors.navyMid},
  flex: {flex: 1, minWidth: 0},
  top: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  name: {...Typography.h3, color: Colors.slate900, flex: 1},
  time: {...Typography.badge, lineHeight: 16, color: Colors.slate500},
  subtitle: {...Typography.caption, color: Colors.navyMid, flex: 1},
  last: {
    ...Typography.body,
    color: Colors.slate600,
    marginTop: Spacing.xs,
    flex: 1,
  },
  unread: {
    minWidth: 24,
    minHeight: 24,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: Colors.navyDeep,
  },
  unreadText: {...Typography.badge, lineHeight: 16, color: Colors.white},
});
