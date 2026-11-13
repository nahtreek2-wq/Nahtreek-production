import React from 'react';
import renderer from 'react-test-renderer';
import {Pressable} from 'react-native';
import {CATEGORY_SERVICE_IDS, CategoryGrid} from '../src/components/home/CategoryGrid';

function renderGrid(
  onSelectService = jest.fn(),
  onSelectEngineers = jest.fn(),
) {
  let screen!: renderer.ReactTestRenderer;
  renderer.act(() => {
    screen = renderer.create(
      <CategoryGrid
        onSelectService={onSelectService}
        onSelectEngineers={onSelectEngineers}
      />,
    );
  });
  return {screen, onSelectService, onSelectEngineers};
}

afterEach(() => jest.restoreAllMocks());

it('routes every service tile with its category key', () => {
  const {screen, onSelectService} = renderGrid();
  try {
    const tiles = screen.root.findAllByType(Pressable);
    expect(tiles.length).toBeGreaterThan(1);
    const plumbing = tiles.find(tile => tile.props.accessibilityLabel === 'Plumbing')!;
    renderer.act(() => plumbing.props.onPress());
    expect(onSelectService).toHaveBeenCalledWith('plumbing');
    const ac = tiles.find(tile => tile.props.accessibilityLabel === 'AC Service')!;
    renderer.act(() => ac.props.onPress());
    expect(onSelectService).toHaveBeenCalledWith('ac');
  } finally {
    renderer.act(() => screen.unmount());
  }
});

it('Routes the engineers tile to discovery instead of services', () => {
  const {screen, onSelectService, onSelectEngineers} = renderGrid();
  try {
    const engineers = screen.root
      .findAllByType(Pressable)
      .find(tile => tile.props.accessibilityLabel === 'Engineers')!;
    renderer.act(() => engineers.props.onPress());
    expect(onSelectEngineers).toHaveBeenCalledTimes(1);
    expect(onSelectService).not.toHaveBeenCalled();
  } finally {
    renderer.act(() => screen.unmount());
  }
});

it('renders exactly 8 tiles so no row is left half empty', () => {
  const {screen} = renderGrid();
  try {
    const tiles = screen.root.findAllByType(Pressable);
    expect(tiles).toHaveLength(8);
    expect(tiles.some(tile => tile.props.accessibilityLabel === 'Home Loans')).toBe(false);
  } finally {
    renderer.act(() => screen.unmount());
  }
});

it('Maps every app tile to a live service slug', () => {
  expect(CATEGORY_SERVICE_IDS).toMatchObject({
    plumbing: 'plumbing',
    electrical: 'electrical',
    painting: 'painting',
    carpentry: 'carpentry',
    masonry: 'masonry',
    ac: 'ac',
    cleaning: 'cleaning',
  });
});
