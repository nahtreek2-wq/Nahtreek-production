import React from 'react';
import renderer from 'react-test-renderer';
import {Pressable, Text, TouchableOpacity} from 'react-native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {ServiceBookingForm} from '../src/components/ServiceBookingForm';
import {api} from '../src/services/apiClient';

jest.mock('../src/services/apiClient', () => ({api: {post: jest.fn(), get: jest.fn().mockRejectedValue(new Error('offline'))}}));
jest.mock('../src/components/LocationPicker', () => {
  const {Pressable: MockPressable, Text: MockText} = require('react-native');
  return {LocationPicker: ({onSelect, onSearching}: any) => (
    <>
      <MockPressable accessibilityLabel="Choose address A" onPress={() => {onSearching();onSelect({address:'A',city:'A',state:'TN',latitude:11,longitude:77});}}><MockText>A</MockText></MockPressable>
      <MockPressable accessibilityLabel="Choose address B" onPress={() => {onSearching();onSelect({address:'B',city:'B',state:'TN',latitude:12,longitude:78});}}><MockText>B</MockText></MockPressable>
    </>
  )};
});

it('does not show professionals returned for a previous address', async () => {
  jest.useFakeTimers();
  let resolveSearch!: (result: unknown) => void;
  (api.post as jest.Mock).mockImplementation(() => new Promise(resolve => {resolveSearch = resolve;}));
  const queryClient = new QueryClient({defaultOptions: {mutations: {retry: false}}});
  let screen!: renderer.ReactTestRenderer;
  renderer.act(() => {
    screen = renderer.create(
      <QueryClientProvider client={queryClient}>
        <ServiceBookingForm serviceId="repair" onBooked={jest.fn()} />
      </QueryClientProvider>,
    );
  });
  renderer.act(() => screen.root.findAllByType(Pressable)
    .find(item => item.props.accessibilityLabel === 'Choose address A')!.props.onPress());
  renderer.act(() => screen.root.findAllByType(TouchableOpacity)
    .find(item => item.props.accessibilityLabel === 'Check professionals at this address')!.props.onPress());
  await Promise.resolve();
  expect(api.post).toHaveBeenCalledTimes(1);
  renderer.act(() => screen.root.findAllByType(Pressable)
    .find(item => item.props.accessibilityLabel === 'Choose address B')!.props.onPress());
  await renderer.act(async () => {
    resolveSearch({data: [{id:'old-provider',fullName:'Old address professional',distanceKm:1,etaMinutes:10}]});
    await Promise.resolve();
  });
  expect(screen.root.findAllByType(Text).map(item => item.props.children)
    .flat(Infinity)).not.toContain('Old address professional');
  renderer.act(() => screen.unmount());
  queryClient.clear();
  jest.clearAllTimers();
  jest.useRealTimers();
});
