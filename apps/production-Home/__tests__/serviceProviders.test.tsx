import React from 'react';
import {Pressable, Text} from 'react-native';
import renderer from 'react-test-renderer';

const mockNavigation = {goBack: jest.fn(), navigate: jest.fn(), push: jest.fn()};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({params: {serviceId: 'painting', title: 'Painting'}}),
}));
jest.mock('../src/services/platformQueries', () => ({
  useServiceProviders: () => ({
    data: {
      pages: [
        {
          data: [
            {
              id: 'profile-1',
              fullName: 'Arun',
              title: 'Painter',
              baseCity: 'Chennai',
              isAvailable: true,
              yearsOfExperience: 6,
              averageRating: 4.5,
              totalReviewsCount: 12,
              startingPricePaisa: 49900,
              baseLatitude: 13.0,
              baseLongitude: 80.2,
            },
          ],
        },
      ],
    },
    isPending: false,
    isError: false,
    isRefetching: false,
    refetch: jest.fn(),
    hasNextPage: false,
  }),
}));
jest.mock('../src/stores/city', () => ({
  useCity: (selector: (state: object) => unknown) =>
    selector({city: 'Chennai', state: 'Tamil Nadu', setCity: jest.fn()}),
}));
jest.mock('../src/stores/session', () => ({
  useSessionStore: (selector: (state: object) => unknown) =>
    selector({accessToken: 'token', user: {id: 'client-1'}}),
}));
jest.mock('../src/services/queries', () => ({
  useUpdateClientProfile: () => ({mutate: jest.fn()}),
  useFavoritesList: () => ({data: []}),
  useToggleFavorite: () => ({isPending: false, mutate: jest.fn()}),
}));
jest.mock('../src/stores/toast', () => ({
  useToast: () => jest.fn(),
}));
jest.mock('../src/services/config', () => ({isApiConfigured: true}));
jest.mock('../src/components/ui', () => {
  const NativeText = jest.requireActual('react-native').Text;
  return {
    AppHeader: ({title}: {title: string}) => <NativeText>{title}</NativeText>,
    Avatar: () => null,
    BottomSheet: () => null,
    Button: ({label, onPress}: {label: string; onPress: () => void}) => (
      <NativeText onPress={onPress}>{label}</NativeText>
    ),
    Icon: () => null,
    ICONS: {location: 'location', chevronRight: 'chevronRight'},
    MemberBadge: () => null,
    RatingStars: () => null,
  };
});
jest.mock('../src/screens/PlatformHistoryScreen', () => ({
  platformStyles: new Proxy({}, {get: () => ({})}),
}));
jest.mock('../src/components/SkeletonLoader', () => ({
  ProviderCardSkeleton: () => null,
}));
jest.mock('../src/components/ScrollMotionBar', () => ({
  useScrollMotion: () => ({offset: {interpolate: () => 0}, reducedMotion: true}),
  ScrollMotionBar: () => null,
}));
jest.mock('../src/components/DistrictLocationPicker', () => ({
  DistrictLocationPicker: () => null,
}));
jest.mock('../src/components/ServiceBookingForm', () => ({
  ServiceBookingForm: () => null,
}));

import {ServiceProvidersScreen} from '../src/screens/ServiceProvidersScreen';

describe('ServiceProvidersScreen routing', () => {
  beforeEach(() => {
    mockNavigation.navigate.mockClear();
  });

  it('Opens the provider profile when the card header is tapped', () => {
    let screen!: renderer.ReactTestRenderer;
    renderer.act(() => {
      screen = renderer.create(<ServiceProvidersScreen />);
    });
    try {
      const header = screen.root
        .findAllByType(Pressable)
        .find(node => node.props.accessibilityLabel === 'View Arun profile')!;
      renderer.act(() => header.props.onPress());
      expect(mockNavigation.navigate).toHaveBeenCalledWith('ProviderProfile', {
        professionalProfileId: 'profile-1',
      });
    } finally {
      renderer.act(() => screen.unmount());
    }
  });

  it('Keeps booking on the request button instead of the profile', () => {
    let screen!: renderer.ReactTestRenderer;
    renderer.act(() => {
      screen = renderer.create(<ServiceProvidersScreen />);
    });
    try {
      const request = screen.root
        .findAllByType(Text)
        .find(node => node.props.children === 'Request this professional')!;
      renderer.act(() => (request.props as {onPress: () => void}).onPress());
      expect(mockNavigation.navigate).not.toHaveBeenCalledWith(
        'ProviderProfile',
        expect.anything(),
      );
    } finally {
      renderer.act(() => screen.unmount());
    }
  });
});
