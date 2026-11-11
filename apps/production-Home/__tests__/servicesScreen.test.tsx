import React from 'react';
import {Pressable} from 'react-native';
import renderer from 'react-test-renderer';

let mockRouteParams: {serviceId?: string} = {};
const mockNavigation = {goBack: jest.fn(), push: jest.fn(), navigate: jest.fn()};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({params: mockRouteParams}),
}));
jest.mock('../src/services/platformQueries', () => ({
  useServiceCategories: () => ({
    data: [{
      id: 'painting',
      slug: 'painting',
      title: 'Painting',
      group: 'Home Services',
      description: 'Interior and exterior painting help.',
      prepare: 'Estimate the area and finish.',
    }],
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));
jest.mock('../src/components/ScrollMotionBar', () => ({
  useScrollMotion: () => ({offset: {interpolate: () => 0}, reducedMotion: true}),
  ScrollMotionBar: () => null,
}));
jest.mock('../src/components/ui', () => ({
  ...(() => {
    const NativeText = jest.requireActual('react-native').Text;
    return {
      AppHeader: ({title}: {title: string}) => <NativeText>{title}</NativeText>,
      Button: ({label, onPress}: {label: string; onPress: () => void}) => (
        <NativeText onPress={onPress}>{label}</NativeText>
      ),
      Icon: () => null,
      ICONS: {chevronRight: 'chevronRight'},
    };
  })(),
}));

import {ServicesScreen} from '../src/screens/ServicesScreen';

describe('ServicesScreen', () => {
  beforeEach(() => {
    mockRouteParams = {};
    mockNavigation.push.mockClear();
  });

  it('opens a selected service and renders its detail action', async () => {
    let screen!: renderer.ReactTestRenderer;
    await renderer.act(async () => {
      screen = renderer.create(<ServicesScreen />);
    });

    const serviceCard = screen.root.findAllByType(Pressable)[0];
    await renderer.act(async () => serviceCard.props.onPress());
    expect(mockNavigation.push).toHaveBeenCalledWith('Services', {serviceId: 'painting'});

    mockRouteParams = {serviceId: 'painting'};
    await renderer.act(async () => screen.update(<ServicesScreen />));
    expect(screen.root.findByProps({children: 'Interior and exterior painting help.'})).toBeTruthy();
    expect(screen.root.findByProps({children: 'Find help near me'})).toBeTruthy();
    await renderer.act(async () => screen.unmount());
  });
});
