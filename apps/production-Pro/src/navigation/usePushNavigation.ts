import {useEffect} from 'react';
import {NativeEventEmitter, NativeModules} from 'react-native';
import {navigationRef} from './navRef';

export type ProPushDestinationPayload = {
  destination?: string;
  requestId?: string;
  conversationId?: string;
  senderName?: string;
};

// Maps a push tap-through payload to a navigation target. Unknown or
// incomplete payloads fall back to Home so a tap never strands the user.
export function routeForProPushDestination(payload: ProPushDestinationPayload | null | undefined) {
  if (!payload?.destination) return null;
  switch (payload.destination) {
    case 'pro-request':
      return payload.requestId
        ? {tab: 'Requests' as const, screen: 'RequestDetail' as const, params: {id: payload.requestId, kind: 'engineering' as const}}
        : null;
    case 'pro-chat':
      return payload.conversationId
        ? {tab: 'Messages' as const, screen: 'Chat' as const, params: {conversationId: payload.conversationId, title: payload.senderName ?? 'Chat'}}
        : null;
    case 'pro-requests':
      return {tab: 'Requests' as const, screen: 'RequestInbox' as const, params: undefined};
    case 'pro-reviews':
      return {tab: 'Profile' as const, screen: 'Reviews' as const, params: undefined};
    case 'support':
      return {tab: 'Profile' as const, screen: 'Support' as const, params: undefined};
    case 'pro-profile':
      return {tab: 'Profile' as const, screen: 'ProfileOverview' as const, params: undefined};
    case 'pro-home':
    default:
      return {tab: 'Home' as const, screen: undefined, params: undefined};
  }
}

// Handles notification taps: cold starts via getInitialNotification and
// warm taps via the NahtreekPushOpened event. Only navigates for signed-in
// users; signed-out users land on login where the bell keeps the content.
export function useProPushNavigation(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const native = NativeModules.NahtreekPush;
    if (!native) return;
    let stopped = false;
    const open = (payload: ProPushDestinationPayload | null | undefined) => {
      const route = routeForProPushDestination(payload);
      if (!route || !navigationRef.isReady()) return;
      if (route.tab === 'Home') {
        navigationRef.navigate('Main', {screen: 'Home'});
        return;
      }
      navigationRef.navigate('Main', {
        screen: route.tab,
        params: route.screen ? {screen: route.screen, params: route.params} : undefined,
      } as never);
    };
    const events = new NativeEventEmitter(native);
    const subscription = events.addListener('NahtreekPushOpened', open);
    if (typeof native.getInitialNotification === 'function') {
      native
        .getInitialNotification()
        .then((payload: ProPushDestinationPayload | null) => {
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
