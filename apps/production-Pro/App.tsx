import React, {useEffect, useMemo, useCallback} from 'react';
import {usePushNotifications} from '../../packages/mobile-push/usePushNotifications';
import {runtimeConfig} from './src/config/runtime';
import {AppState, NativeModules, StatusBar} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {focusManager, onlineManager, QueryClient, QueryClientProvider} from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {Colors} from '@nahtreek/design-system';
import {RootNavigator} from './src/navigation/RootNavigator';
import {linking} from './src/navigation/linking';
import {navigationRef} from './src/navigation/navRef';
import {usePersistedNavigationState} from './src/navigation/navigationPersistence';
import {useProPushNavigation} from './src/navigation/usePushNavigation';
import {ProToast} from './src/components/ProToast';
import {AppErrorBoundary} from './src/app/AppErrorBoundary';
import {useSessionStore} from './src/stores/session';
import {ConnectivityNotice} from './src/components/ConnectivityNotice';
import {openChatSocket} from './src/services/chatSocket';
import {warnForCompromiseOnce} from './src/services/deviceIntegrity';
import {api, ensureFreshSession} from './src/services/apiClient';

const registerPushDevice = (token: string, app: 'client' | 'professional') => api.post('/notifications/devices', {token, app});

export default function App() {
  const accountId = useSessionStore(state => state.user?.id ?? 'signed-out');
  const accessToken = useSessionStore(state => state.accessToken);
  const hydrated = useSessionStore(state => state.hydrated);
  const hydrate = useSessionStore(state => state.hydrate);
  useEffect(() => {
    if (!hydrated) void hydrate().catch(() => undefined);
  }, [hydrate, hydrated]);
  const persistedNav = usePersistedNavigationState(accountId, hydrated, !!accessToken);
  useEffect(() => {
    if (!accessToken) void NativeModules.NahtreekRuntimeConfig?.stopLiveLocation?.();
    else void NativeModules.NahtreekRuntimeConfig?.updateLiveLocationToken?.(accessToken);
  }, [accountId, accessToken]);
  useEffect(() => () => {void NativeModules.NahtreekRuntimeConfig?.stopLiveLocation?.();}, [accountId]);
  const queryClient = useMemo(() => new QueryClient({
    defaultOptions: {queries: {retry: (attempt, error) => attempt < 1 && (!('status' in error) || [0, 502, 503, 504].includes(Number(error.status))), staleTime: 30_000, meta: {accountId}}},
  }), [accountId]);
  const refreshForPush = useCallback(() => {void queryClient.invalidateQueries();}, [queryClient]);
  usePushNotifications({userId: accountId === 'signed-out' ? undefined : accountId, accessToken, baseUrl: runtimeConfig.apiBaseUrl, app: 'professional', onUpdate: refreshForPush, registerDevice: registerPushDevice});
  useProPushNavigation(accountId !== 'signed-out' && !!accessToken);
  useEffect(() => {
    if (!accessToken || accountId === 'signed-out') return;
    const socket = openChatSocket(accessToken);
    if (!socket) return;
    const refresh = (event?: {resource?: string}) => {
      const keys: Record<string, string[][]> = {
        requests: [['professional-requests'], ['professional-request-summary'], ['professional-request-detail']],
        'service-requests': [['professional-requests'], ['professional-request-summary'], ['professional-request-detail'], ['service-journey']],
        notifications: [['professional-notifications']],
        conversations: [['professional-conversations'], ['professional-messages']],
        profile: [['professional-profile']],
      };
      const relevant = event?.resource ? keys[event.resource] : undefined;
      if (!relevant) {void queryClient.invalidateQueries(); return;}
      relevant.forEach(queryKey => {void queryClient.invalidateQueries({queryKey});});
    };
    socket.on('connect', refresh);
    socket.on('data:changed', refresh);
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') socket.connect();
      else socket.disconnect();
    });
    return () => {
      appState.remove();
      socket.off('connect', refresh);
      socket.off('data:changed', refresh);
      socket.disconnect();
    };
  }, [accessToken, accountId, queryClient]);
  useEffect(() => () => {queryClient.cancelQueries().catch(() => undefined); queryClient.clear();}, [queryClient]);
  useEffect(() => {
    if (accessToken) {void ensureFreshSession();}
  }, [accessToken]);
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => onlineManager.setOnline(state.isConnected !== false && state.isInternetReachable !== false));
    const listener = AppState.addEventListener('change', state => {
      focusManager.setFocused(state === 'active');
      if (state === 'active' && useSessionStore.getState().accessToken) {void ensureFreshSession();}
    });
    return () => {unsubscribe(); listener.remove();};
  }, []);
  useEffect(() => {warnForCompromiseOnce();}, []);
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar barStyle="light-content" backgroundColor={Colors.navyDeep} />
        <AppErrorBoundary><ConnectivityNotice />{hydrated && persistedNav.ready ? (<NavigationContainer ref={navigationRef} linking={linking} initialState={persistedNav.initialState} onStateChange={persistedNav.onStateChange}><RootNavigator instantSplash={!!persistedNav.initialState} /></NavigationContainer>) : null}</AppErrorBoundary>
        <ProToast />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
