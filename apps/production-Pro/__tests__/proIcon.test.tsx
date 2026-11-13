import React from 'react';
import renderer from 'react-test-renderer';
import {View} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {ProIcon} from '../src/components/ProIcon';
import type {IconTone} from '../src/components/ProIcon';
import {ProColors} from '../src/theme/professionalTheme';

const EXPECTED: Record<IconTone, string> = {
  navy: ProColors.primary,
  blue: '#2563EB',
  green: ProColors.success,
  red: ProColors.error,
  slate: '#52627A',
};

it.each(Object.keys(EXPECTED) as IconTone[])('tone %s renders a plain glyph with no background', tone => {
  let screen!: renderer.ReactTestRenderer;
  renderer.act(() => {
    screen = renderer.create(<ProIcon name="cash" tone={tone} />);
  });
  const frame = screen.root.findByType(View);
  const style = Array.isArray(frame.props.style) ? Object.assign({}, ...frame.props.style) : frame.props.style;
  expect(style.backgroundColor).toBeUndefined();
  const icon = screen.root.findByType(MaterialCommunityIcons);
  expect(icon.props.name).toBe('cash');
  expect(icon.props.color).toBe(EXPECTED[tone]);
  expect(icon.props.size).toBe(24);
  renderer.act(() => screen.unmount());
});

it('sizes the frame from the size prop', () => {
  let screen!: renderer.ReactTestRenderer;
  renderer.act(() => {
    screen = renderer.create(<ProIcon name="cash" size={58} iconSize={30} />);
  });
  const frame = screen.root.findByType(View);
  const style = Array.isArray(frame.props.style) ? Object.assign({}, ...frame.props.style) : frame.props.style;
  expect(style.width).toBe(58);
  expect(style.height).toBe(58);
  expect(screen.root.findByType(MaterialCommunityIcons).props.size).toBe(30);
  renderer.act(() => screen.unmount());
});
