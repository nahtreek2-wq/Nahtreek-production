import {io, type Socket} from 'socket.io-client';
import {runtimeConfig} from '../config/runtime';

export function openChatSocket(accessToken: string): Socket | null {
  const base = runtimeConfig.apiBaseUrl?.replace(/\/api\/v1\/?$/, '');
  if (!base) {return null;}
  // F-214: bounded retries + handshake timeout, same as the Home client —
  // an uncapped socket on a hostile network retries (and wakes the radio)
  // forever without ever delivering a message.
  return io(`${base}/chat`, {
    path: '/socket.io',
    transports: ['websocket'],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 5,
    timeout: 8_000,
    auth: {token: accessToken},
  });
}
