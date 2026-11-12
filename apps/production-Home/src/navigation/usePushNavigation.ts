import {useEffect} from 'react';
import {NativeEventEmitter, NativeModules} from 'react-native';
import {createNavigationContainerRef} from '@react-navigation/native';
import type {RootStackParamList} from './types';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export type PushDestinationPayload = {
  destination?: string;
  conversationId?: string;
  serviceRequestId?: string;
  requestId?: string;
  senderName?: string;
};

export type PushRoute =
  | {name: 'Chat'; params: {conversationId: string; title: string}}
  | {name: 'RequestDetail'; params: {requestId: string}}
  | {name: 'ServiceRequestDetail'; params: {requestId: string}}
  | {name: 'EngineerDiscovery'; params: undefined}
  | {name: 'Notifications'; params: undefined}
  | {name: 'Help'; params: undefined}
  | {name: 'MainTabs'; params: {screen: 'Home' | 'Profile'}};

// Maps a push tap-through payload to a navigation target. Unknown or
// incomplete payloads fall back to Home so a tap never strands the user.
export function routeForPushDestination(payload: PushDestinationPayload | null | undefined): PushRoute | null {
  if (!payload?.destination) return null;
  switch (payload.destination) {
    case 'chat':
      return payload.conversationId
        ? {name: 'Chat', params: {conversationId: payload.conversationId, title: payload.senderName ?? 'Chat'}}
        : null;
    case 'service-request':
      return payload.serviceRequestId ? {name: 'ServiceRequestDetail', params: {requestId: payload.serviceRequestId}} : null;
    case 'engineer-request':
      return payload.requestId ? {name: 'RequestDetail', params: {requestId: payload.requestId}} : null;
    case 'discover':
      return {name: 'EngineerDiscovery', params: undefined};
    case 'notifications':
      return {name: 'Notifications', params: undefined};
    case 'support':
      return {name: 'Help', params: undefined};
    case 'profile':
      return {name: 'MainTabs', params: {screen: 'Profile'}};
    case 'home':
    default:
      return {name: 'MainTabs', params: {screen: 'Home'}};
  }
}

// Handles notification taps: cold starts via getInitialNotification and
// warm taps via the NahtreekPushOpened event. Only navigates for signed-in
// users; signed-out users land on login where the in-app bell keeps the same content.
export function usePushNavigation(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const native = NativeModules.NahtreekPush;
    if (!native) return;
    let stopped = false;
    const open = (payload: PushDestinationPayload | null | undefined) => {
      const route = routeForPushDestination(payload);
      if (!route || !navigationRef.isReady()) return;
      if (route.name === 'MainTabs') navigationRef.navigate(route.name, route.params);
      else if (route.name === 'Chat') navigationRef.navigate(route.name, route.params);
      else if (route.name === 'ServiceRequestDetail') navigationRef.navigate(route.name, route.params);
      else if (route.name === 'RequestDetail') navigationRef.navigate(route.name, route.params);
      else navigationRef.navigate(route.name as 'EngineerDiscovery');
    };
    const events = new NativeEventEmitter(native);
    const subscription = events.addListener('NahtreekPushOpened', open);
    if (typeof native.getInitialNotification === 'function') {
      native
        .getInitialNotification()
        .then((payload: PushDestinationPayload | null) => {
          if (!stopped) open(payload);
        })
        .catch(() => undefined);
    }
    return () => {
      stopped = true;
      subscription.remove();
    };
  }, [enabled]);
}
