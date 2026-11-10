import React from 'react';
import renderer from 'react-test-renderer';
import {Text} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {NavigationContainer} from '@react-navigation/native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {MyQrScreen} from '../src/screens/MyQrScreen';
import type {ReviewQrView} from '../src/screens/MyQrScreen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

const view: ReviewQrView = {url: 'https://nahtreek-website.vercel.app/p/prof-1', code: 'KX7Q2M',
  qrPng: 'data:image/png;base64,AAA', fullName: 'Eng Narayanan', averageRating: 4.5, totalReviewsCount: 2};

it('shows the QR, manual code and rating', async () => {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  let screen!: renderer.ReactTestRenderer;
  await renderer.act(async () => {
    screen = renderer.create(<NavigationContainer><QueryClientProvider client={client}>
      <MyQrScreen load={jest.fn().mockResolvedValue(view)} />
    </QueryClientProvider></NavigationContainer>);
  });
  await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  const texts = screen.root.findAllByType(Text)
    .map(t => (Array.isArray(t.props.children) ? t.props.children.join('') : (t.props.children ?? '')).toString()).join('\n');
  expect(texts).toContain('KX7Q2M');
  expect(texts).toContain('Eng Narayanan');
  expect(texts).toContain('4.5');
  await renderer.act(() => screen.unmount());
});

it('shows the cached QR with a stale banner when offline', async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('pro-review-qr.cache.v1', JSON.stringify({view, savedAt: '2026-11-01T00:00:00Z'}));
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  let screen!: renderer.ReactTestRenderer;
  await renderer.act(async () => {
    screen = renderer.create(<NavigationContainer><QueryClientProvider client={client}>
      <MyQrScreen load={jest.fn().mockRejectedValue(new Error('offline'))} />
    </QueryClientProvider></NavigationContainer>);
  });
  await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  const texts = screen.root.findAllByType(Text)
    .map(t => (Array.isArray(t.props.children) ? t.props.children.join('') : (t.props.children ?? '')).toString()).join('\n');
  expect(texts).toContain('KX7Q2M');
  expect(texts).toContain('Offline — showing your saved QR');
  await renderer.act(() => screen.unmount());
  await AsyncStorage.clear();
});
