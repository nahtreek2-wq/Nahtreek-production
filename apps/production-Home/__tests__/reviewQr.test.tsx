import React from 'react';
import renderer from 'react-test-renderer';
import {Text} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {parsePayQr, parseReviewQr, ScanScreen} from '../src/screens/ScanScreen';
import {ProviderProfileScreen} from '../src/screens/ProviderProfileScreen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));
jest.mock('../src/services/apiClient', () => ({api: {get: jest.fn()}}));
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {...actual, useRoute: () => ({params: {professionalProfileId: 'prof-1'}})};
});

const {api} = jest.requireMock('../src/services/apiClient');

function textsOf(screen: renderer.ReactTestRenderer) {
  return screen.root.findAllByType(Text)
    .map(t => (Array.isArray(t.props.children) ? t.props.children.join('') : (t.props.children ?? '')).toString()).join('\n');
}

async function renderWith(screen_: React.ReactElement) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  let screen!: renderer.ReactTestRenderer;
  await renderer.act(async () => {
    screen = renderer.create(<NavigationContainer><QueryClientProvider client={client}>{screen_}</QueryClientProvider></NavigationContainer>);
  });
  await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  return screen;
}

describe('parseReviewQr', () => {
  it('accepts site links, app links and rejects the rest', () => {
    expect(parseReviewQr('https://nahtreek-website.vercel.app/p/9b2f4c1a-3d4e-4f5a-8b6c-7d8e9f0a1b2c'))
      .toBe('9b2f4c1a-3d4e-4f5a-8b6c-7d8e9f0a1b2c');
    expect(parseReviewQr('nahtreek://p/abc12345')).toBe('abc12345');
    expect(parseReviewQr('https://evil.example.com/p/abc12345')).toBe('abc12345');
    expect(parseReviewQr('https://nahtreek-website.vercel.app/about')).toBeNull();
    expect(parseReviewQr('not a url')).toBeNull();
    expect(parseReviewQr('nahtreek://pay/9b2f4c1a-3d4e-4f5a-8b6c-7d8e9f0a1b2c')).toBeNull();
  });
});

describe('parsePayQr', () => {
  it('accepts booking payment links and rejects the rest', () => {
    expect(parsePayQr('nahtreek://pay/9b2f4c1a-3d4e-4f5a-8b6c-7d8e9f0a1b2c'))
      .toBe('9b2f4c1a-3d4e-4f5a-8b6c-7d8e9f0a1b2c');
    expect(parsePayQr('  nahtreek://pay/abc12345/  ')).toBe('abc12345');
    expect(parsePayQr('nahtreek://p/abc12345')).toBeNull();
    expect(parsePayQr('https://nahtreek-website.vercel.app/p/abc12345')).toBeNull();
    expect(parsePayQr('not a url')).toBeNull();
  });
});

describe('ScanScreen', () => {
  it('resolves a manual code into the ratings page', async () => {
    api.get.mockResolvedValue({professionalProfileId: 'prof-1'});
    const screen = await renderWith(<ScanScreen />);
    expect(textsOf(screen)).toContain('6-character code');
    const input = screen.root.findByProps({accessibilityLabel: '6-character review code'});
    await renderer.act(async () => { input.props.onChangeText('kx7q2m'); });
    const open = screen.root.findByProps({label: 'Open ratings'});
    await renderer.act(async () => { open.props.onPress(); });
    await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(api.get).toHaveBeenCalledWith('/discovery/providers/by-code/KX7Q2M');
    await renderer.act(() => screen.unmount());
  });
});

describe('ProviderProfileScreen', () => {
  it('shows the public card with reviews', async () => {
    api.get.mockResolvedValue({id: 'prof-1', fullName: 'Eng Narayanan', avatarUrl: null, title: 'Civil Engineer',
      bio: 'Fixer of leaks', baseCity: 'Chennai', baseState: 'TN', yearsOfExperience: 8, serviceCategories: ['PLUMBING'],
      averageRating: 4.5, totalReviewsCount: 1, verificationStatus: 'VERIFIED',
      reviews: [{id: 'r1', rating: 5, comment: 'Great work', createdAt: '2026-01-02T00:00:00Z', clientName: 'Asha'}]});
    const screen = await renderWith(<ProviderProfileScreen />);
    const texts = textsOf(screen);
    expect(api.get).toHaveBeenCalledWith('/discovery/providers/prof-1');
    expect(texts).toContain('Eng Narayanan');
    expect(texts).toContain('Great work');
    expect(texts).toContain('Asha');
    await renderer.act(() => screen.unmount());
  });
});
