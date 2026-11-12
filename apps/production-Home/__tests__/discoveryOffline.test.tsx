import React from 'react';
import {Text} from 'react-native';
import renderer from 'react-test-renderer';
import {ApiError} from '../src/services/apiClient';

const mockRefetch = jest.fn();
const mockNavigate = jest.fn();
let mockEngineListState: Record<string, unknown> = {};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: (...args: unknown[]) => mockNavigate(...args),
    goBack: jest.fn(),
    getState: () => ({type: 'tab'}),
  }),
  useRoute: () => ({params: undefined}),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));
jest.mock('@react-navigation/bottom-tabs', () => ({
  useBottomTabBarHeight: jest.fn(() => 0),
}));
jest.mock('../src/services/queries', () => ({
  useEngineList: () => mockEngineListState,
  useFavoritesList: () => ({data: []}),
  useToggleFavorite: () => ({isPending: false, mutate: jest.fn()}),
  useCreateRequest: () => ({isPending: false, mutate: jest.fn()}),
  useUpdateClientProfile: () => ({isPending: false, mutate: jest.fn()}),
}));
jest.mock('../src/services/platformQueries', () => ({
  useServiceCategories: () => ({data: [], isLoading: false, isError: false, refetch: jest.fn()}),
}));
jest.mock('../src/components/SkeletonLoader', () => ({
  EngineerCardSkeleton: () => null,
}));
jest.mock('../src/components/ConsultationSheet', () => ({
  ConsultationSheet: () => null,
}));
jest.mock('../src/components/DistrictLocationPicker', () => ({
  DistrictLocationPicker: () => null,
}));
jest.mock('../src/assets/imagery', () => ({
  portraitFor: () => null,
  professionalSceneFor: () => null,
}));
jest.mock('../src/services/planQuotes', () => ({
  usePlanDraft: () => null,
  usePlanQuoteRequest: () => jest.fn(),
  planSheetPrefill: () => undefined,
}));

import {EngineerDiscoveryScreen} from '../src/screens/EngineerDiscoveryScreen';
import {OfflineBanner} from '../src/components/ui/OfflineBanner';

function texts(screen: renderer.ReactTestRenderer): string[] {
  return screen.root.findAllByType(Text).map(node => {
    const children = node.props.children;
    return Array.isArray(children) ? children.join('') : String(children ?? '');
  });
}

function renderDiscovery() {
  let screen!: renderer.ReactTestRenderer;
  renderer.act(() => {
    screen = renderer.create(<EngineerDiscoveryScreen />);
  });
  return screen;
}

describe('EngineerDiscoveryScreen offline banner', () => {
  beforeEach(() => {
    mockRefetch.mockClear();
    mockEngineListState = {
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      isOffline: false,
      isRefetching: false,
      refetch: mockRefetch,
      loadMore: jest.fn(),
    };
  });

  it('shows the banner with retry when the engineer query fails with no results', () => {
    mockEngineListState = {
      ...mockEngineListState,
      isError: true,
      error: new ApiError(0, 'Could not connect.'),
      isOffline: true,
    };
    const screen = renderDiscovery();
    const copy = texts(screen);
    expect(copy).toContain('Service is unavailable');
    expect(copy.some(line => line.includes('We cannot reach Nahtreek right now'))).toBe(true);
    expect(copy).toContain('Try again');

    const retry = screen.root.findByProps({accessibilityLabel: 'Retry loading this screen'});
    renderer.act(() => retry.props.onPress());
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('stays hidden for a healthy empty result set', () => {
    const screen = renderDiscovery();
    const copy = texts(screen);
    expect(copy).not.toContain('Service is unavailable');
    expect(copy).not.toContain('No internet connection');
    expect(copy).not.toContain('Try again');
    expect(copy).toContain('0 found');
  });

  it('renders on a stack route where no tab bar exists', () => {
    // Saved/Search/Requests push the stack route: the raw tab-height hook
    // throws there, which used to land users on an error page.
    const tabs = jest.requireMock('@react-navigation/bottom-tabs') as {useBottomTabBarHeight: jest.Mock};
    tabs.useBottomTabBarHeight.mockImplementationOnce(() => {
      throw new Error("Couldn't find the bottom tab bar height. Are you inside a screen in Bottom Tab Navigator?");
    });
    const screen = renderDiscovery();
    const copy = texts(screen);
    expect(copy).toContain('Find');
    expect(copy).toContain('0 found');
    renderer.act(() => screen.unmount());
  });
});

describe('EngineerRow targets', () => {
  const engineer = {
    id: 'eng-1',
    professionalProfileId: 'pro-1',
    fullName: 'Arun Prakash',
    avatarUrl: undefined,
    title: 'Structural Engineer',
    specializations: ['Structural Design'],
    averageRating: 4.9,
    totalReviewsCount: 87,
    yearsOfExperience: 11,
    verificationStatus: 'VERIFIED',
    isAvailable: true,
    baseCity: 'Chennai',
    baseLatitude: 13.08,
    baseLongitude: 80.27,
    distanceKm: 3,
    nextSlot: 'Tomorrow 10:00',
    bio: 'Safe designs for homes.',
    consultationFeePaisa: 49900,
  };

  beforeEach(() => {
    mockNavigate.mockClear();
    mockEngineListState = {
      data: [engineer],
      isLoading: false,
      isError: false,
      error: null,
      isOffline: false,
      isRefetching: false,
      refetch: mockRefetch,
      loadMore: jest.fn(),
    };
  });

  it('renders the compact card and opens the profile on press', () => {
    const screen = renderDiscovery();
    const copy = texts(screen);
    expect(copy).toContain('Arun Prakash');
    expect(copy.some(line => line.includes('499'))).toBe(true);
    expect(copy).toContain('Request consultation');

    const card = screen.root.findByProps({accessibilityLabel: 'Open Arun Prakash'});
    renderer.act(() => card.props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('EngineerProfile', {engineerId: 'eng-1'});
  });

  it('sends signed-out users to login for consult and save actions', () => {
    const screen = renderDiscovery();
    const consult = screen.root.findByProps({accessibilityLabel: 'Request consultation'});
    renderer.act(() => consult.props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('Login');

    const heart = screen.root.findByProps({accessibilityLabel: 'Save engineer'});
    renderer.act(() => heart.props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('Login');
  });

  it('filters the list through specialization chips', () => {
    const other = {...engineer, id: 'eng-2', professionalProfileId: 'pro-2', fullName: 'Meera Krishnan', specializations: ['Architectural 3D']};
    mockEngineListState = {...mockEngineListState, data: [engineer, other]};
    const screen = renderDiscovery();
    expect(texts(screen)).toContain('2 found');

    const chip = screen.root.findByProps({accessibilityLabel: 'Browse Structural'});
    renderer.act(() => chip.props.onPress());
    expect(texts(screen)).toContain('1 found');
    expect(texts(screen)).toContain('Arun Prakash');
  });
});

describe('OfflineBanner empty-state copy', () => {
  it('omits the cached-results prefix when there is no content', () => {
    let screen!: renderer.ReactTestRenderer;
    renderer.act(() => {
      screen = renderer.create(
        <OfflineBanner force={true} error={new ApiError(0, 'down')} hasContent={false} />,
      );
    });
    const copy = texts(screen);
    expect(copy).toContain('Service is unavailable');
    expect(copy.some(line => line.includes('Showing the last available results'))).toBe(false);
  });

  it('keeps the cached-results prefix when content is shown', () => {
    let screen!: renderer.ReactTestRenderer;
    renderer.act(() => {
      screen = renderer.create(
        <OfflineBanner force={true} error={null} hasContent={true} />,
      );
    });
    const copy = texts(screen);
    expect(copy).toContain('Could not update');
    expect(copy.some(line => line.includes('Showing the last available results'))).toBe(true);
  });
});
