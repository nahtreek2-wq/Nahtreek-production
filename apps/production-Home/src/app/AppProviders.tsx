import React, {useMemo, useEffect, useCallback} from 'react';
import {usePushNotifications} from '../../../../packages/mobile-push/usePushNotifications';
import {API_BASES} from '../services/config';
import {StatusBar, AppState} from 'react-native';
import {QueryClient, QueryClientProvider, onlineManager, focusManager} from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import {useSessionStore} from '../stores/session';
import {useToastStore} from '../stores/toast';
import {restorePublicCache, persistPublicCache} from '../services/publicCache';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {AppErrorBoundary} from './AppErrorBoundary';
import {AppNavigator} from '../navigation/AppNavigator';
import {Toast} from '../components/ui/Toast';
import {OfflineBanner} from '../components/ui/OfflineBanner';
import {useCity} from '../stores/city';
import {Colors} from '@nahtreek/design-system';
import {openChatSocket} from '../services/chatSocket';
import {isApiConfigured} from '../services/config';
import {warnForCompromiseOnce} from '../services/deviceIntegrity';
import {api, ensureFreshSession} from '../services/apiClient';

const registerPushDevice = (token: string, app: 'client' | 'professional') => api.post('/notifications/devices', {token, app});

export function AppProviders() {
  const accountId = useSessionStore(state => state.user?.id ?? 'guest');
  const accessToken = useSessionStore(state => state.accessToken);
  const homeCity = useSessionStore(state => state.user?.homeCity);
  const homeState = useSessionStore(state => state.user?.state);
  useEffect(() => { if (homeCity) useCity.getState().setCity(homeCity, homeState); }, [accountId, homeCity, homeState]);
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: (attempt, error) => attempt < 1 && (!('status' in error) || [0, 502, 503, 504].includes(Number(error.status))),
            staleTime: 30_000,
            refetchOnWindowFocus: true,
            meta: {accountId},
          },
        },
      }),
    [accountId],
  );

  useEffect(() => () => { void queryClient.cancelQueries(); queryClient.clear(); }, [queryClient]);
  useEffect(() => {
    if (!isApiConfigured || !accessToken || accountId === 'guest') return;
    const socket = openChatSocket(accessToken);
    if (!socket) return;
    const refresh = (event?: {resource?: string}) => {
      const resource = event?.resource;
      if (!resource) {
        void queryClient.invalidateQueries();
        return;
      }
      const keys: Record<string, string[][]> = {
        requests: [['requests'], ['request-detail'], ['history/me'], ['payment']],
        'service-requests': [['service-requests'], ['service-request'], ['history/me'], ['payment'], ['service-journey']],
        conversations: [['conversations'], ['messages']],
        notifications: [['notifications']],
        profile: [['client-profile'], ['ai-billing']],
      };
      (keys[resource] ?? []).forEach(queryKey => {
        void queryClient.invalidateQueries({queryKey});
      });
    };
    socket.on('connect', refresh);
    socket.on('data:changed', refresh);
    socket.on('message:created', () => refresh({resource: 'conversations'}));
    return () => {
      socket.off('connect', refresh);
      socket.off('data:changed', refresh);
      socket.removeAllListeners('message:created');
      socket.disconnect();
    };
  }, [accessToken, accountId, queryClient]);
  const refreshForPush = useCallback(() => {void queryClient.invalidateQueries();}, [queryClient]);
  usePushNotifications({userId: accountId === 'guest' ? undefined : accountId, accessToken, baseUrl: API_BASES[0], app: 'client', onUpdate: refreshForPush, registerDevice: registerPushDevice});
  useEffect(() => {
    void restorePublicCache(queryClient);
    return persistPublicCache(queryClient);
  }, [queryClient]);
  useEffect(() => {
    if (accessToken) {void ensureFreshSession();}
  }, [accessToken]);
  useEffect(() => {
    let wasOnline: boolean | undefined;
    const unsubscribe = NetInfo.addEventListener(state => {
      const online = state.isConnected !== false && state.isInternetReachable !== false;
      onlineManager.setOnline(online);
      if (wasOnline === false && online) useToastStore.getState().show('Back online', 'success');
      wasOnline = online;
    });
    const listener = AppState.addEventListener('change', state => {
      focusManager.setFocused(state === 'active');
      if (state === 'active' && useSessionStore.getState().accessToken) {void ensureFreshSession();}
    });
    return () => { unsubscribe(); listener.remove(); };
  }, []);
  useEffect(() => { warnForCompromiseOnce(); }, []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar
          barStyle="light-content"
          backgroundColor={Colors.navyDeep}
        />
        <AppErrorBoundary>
          <OfflineBanner topEdge message="Your details stay on this screen. Reconnect before submitting or refreshing." />
          <AppNavigator />
        </AppErrorBoundary>
        <Toast />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
