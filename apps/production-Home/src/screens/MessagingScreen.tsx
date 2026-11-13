import React from 'react';
import {View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {useBottomTabBarHeight} from '@react-navigation/bottom-tabs';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import Animated, {FadeInDown, ReduceMotion} from 'react-native-reanimated';
import {Motion} from '../../../../packages/mobile-ui/motion';
import {Colors, Typography, Spacing} from '@nahtreek/design-system';
import {ClientColors} from '../design-system/tokens';
import {AppHeader, Avatar, Icon, ICONS, OfflineBanner} from '../components/ui';
import {MessageRowSkeleton} from '../components/SkeletonLoader';
import {useConversationsList} from '../services/queries';
import type {RootStackParamList} from '../navigation/types';
import {LIST_PERF} from '../../../../packages/mobile-ui/listPerformance';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// Two jobs with the same pro share a name and photo — the status pill tells
// the rows apart (old servers omit requestStatus, so rows stay pill-less).
const statusLabel = (status: string) => {
  const words = status.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export function MessagingScreen() {
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<Nav>();
  const query = useConversationsList();

  return (
    <View style={styles.container}>
      <AppHeader title="Messages" subtitle="Conversations with your professionals" tab style={styles.compactHeader} />
      <OfflineBanner force={query.isOffline} onRetry={query.refetch} retrying={query.isRefetching} />
      {query.isLoading ? (
        <View style={styles.list}>
          <MessageRowSkeleton />
          <MessageRowSkeleton />
          <MessageRowSkeleton />
        </View>
      ) : (
      <FlatList
        {...LIST_PERF}
        onEndReached={query.loadMore}
        onEndReachedThreshold={0.5}
        data={query.data ?? []}
        keyExtractor={item => item.id}
        contentContainerStyle={[styles.list, {paddingBottom: tabBarHeight + 24}]}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={query.refetch} tintColor={Colors.navyDeep} />}
        ListEmptyComponent={
          !query.isLoading ? (
            <Animated.View entering={FadeInDown.duration(Motion.entrance).reduceMotion(ReduceMotion.System)} style={styles.emptyCard}>
              <View style={styles.emptyIcon}>
                <Icon name={ICONS.messages} size={28} color={Colors.navyDeep} />
              </View>
              <Text accessibilityRole="header" style={styles.emptyTitle}>Your conversations start here</Text>
              <Text style={styles.emptyText}>When a professional accepts your request, you can chat here about the work.</Text>
            </Animated.View>
          ) : null
        }
        renderItem={({item}) => (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`${item.title}${item.unread > 0 ? `, ${item.unread} unread messages` : ''}`}
            activeOpacity={0.7}
            onPress={() =>
              navigation.navigate('Chat', {
                conversationId: item.id,
                title: item.title,
                subtitle: item.subtitle,
                avatarUrl: item.otherAvatarUrl,
              })
            }>
            <View style={styles.card}>
              <View style={styles.row}>
                <Avatar name={item.professionalName} uri={item.otherAvatarUrl} size={46} />
                <View style={styles.body}>
                  <View style={styles.topRow}>
                    <Text style={styles.name} numberOfLines={1}>{item.title}</Text>
                    {item.requestStatus ? <Text style={styles.statusPill} numberOfLines={1}>{statusLabel(item.requestStatus)}</Text> : null}
                    <Text style={styles.time}>{item.lastAt}</Text>
                  </View>
                  <Text style={styles.subtitle} numberOfLines={2}>{item.subtitle}</Text>
                  <View style={styles.bottomRow}>
                    <Text style={styles.last} numberOfLines={2}>{item.lastMessage}</Text>
                    {item.unread > 0 && (
                      <View style={styles.unread}>
                        <Text style={styles.unreadLabel}>{item.unread}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>
            </View>
          </TouchableOpacity>
        )}
        ListFooterComponent={
          <View style={styles.footer}>
            <View style={styles.footerIntro}>
              <Text style={styles.footerTitle}>Start a new conversation</Text>
              <Text style={styles.footerText}>
                Send a request. The chat opens here immediately — you can clarify details before acceptance.
              </Text>
              <View style={styles.footerActions}>
                <TouchableOpacity accessibilityRole="button" style={styles.footerBtn} onPress={() => navigation.navigate('Services')}>
                  <Icon name={ICONS.serviceHero} size={20} color={Colors.navyDeep} />
                  <Text style={styles.linkLabel}>Browse services</Text>
                  <Icon name={ICONS.chevronRight} size={18} color={Colors.navyDeep} />
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" style={styles.footerBtn} onPress={() => navigation.navigate('EngineerDiscovery')}>
                  <Icon name={ICONS.engineers} size={20} color={Colors.interactiveBlue} />
                  <Text style={styles.linkLabel}>Find engineers</Text>
                  <Icon name={ICONS.chevronRight} size={18} color={Colors.navyDeep} />
                </TouchableOpacity>
              </View>
            </View>
            <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.navigate('Help')} accessibilityRole="button" accessibilityLabel="Get help with your account or requests">
              <View style={[styles.footerIntro, styles.helpCard]}>
                <View style={styles.helpRow}>
                  <View style={styles.helpIcon}>
                    <Icon name={ICONS.support} size={18} color={Colors.navyMid} />
                  </View>
                  <View style={styles.body}>
                    <Text style={styles.footerTitle}>Need help?</Text>
                    <Text style={styles.footerText}>See ways to get help with your account or requests.</Text>
                  </View>
                  <Icon name={ICONS.chevronRight} size={16} color={Colors.slate300} />
                </View>
              </View>
            </TouchableOpacity>
          </View>
        }
      />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  compactHeader: {paddingBottom: 12},
  emptyCard: {marginTop: 8, padding: 24, borderRadius: 20, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.slate200, alignItems: 'flex-start'},
  emptyIcon: {width: 52, height: 52, alignItems: 'center', justifyContent: 'center', marginBottom: 16},
  emptyTitle: {fontSize: 20, lineHeight: 26, fontWeight: '800', color: Colors.navyDeep},
  emptyText: {fontSize: 14, lineHeight: 21, color: Colors.slate600, marginTop: 8},
  container: {
    flex: 1,
    backgroundColor: ClientColors.lightBackground,
  },
  list: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  card: {
    paddingVertical: 14,
    minHeight: 88,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.slate200,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  body: {
    flex: 1,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  statusPill: {
    ...Typography.badge,
    lineHeight: 16,
    flexShrink: 0,
    color: Colors.navyMid,
    backgroundColor: Colors.softBlue,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  name: {
    ...Typography.subtitle,
    fontWeight: '700',
    color: ClientColors.primaryNavy,
    flex: 1,
    flexShrink: 1,
  },
  time: {
    ...Typography.badge,
    color: Colors.slate400,
    flexShrink: 0,
  },
  subtitle: {
    ...Typography.caption,
    color: Colors.slate500,
    marginTop: 2,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.xs,
    gap: Spacing.sm,
  },
  last: {
    ...Typography.body,
    color: Colors.slate600,
    flexShrink: 1,
  },
  unread: {
    minWidth: 24,
    minHeight: 24,
    paddingHorizontal: 6,
    borderRadius: 12,
    backgroundColor: ClientColors.primaryNavy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadLabel: {
    ...Typography.badge,
    color: Colors.white,
  },
  footer: {
    marginTop: 12,
  },
  footerIntro: {padding: 18, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.slate200, borderRadius: 18},
  helpCard: {marginTop: 12},
  linkLabel: {flex: 1, fontSize: 15, lineHeight: 21, fontWeight: '600', color: ClientColors.primaryNavy},
  footerTitle: {
    ...Typography.subtitle,
    fontWeight: '700',
    color: Colors.slate900,
  },
  footerText: {
    ...Typography.caption,
    color: Colors.slate500,
    marginTop: 3,
  },
  footerActions: {
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  footerBtn: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.slate200,
  },
  helpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  helpIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
