import React from 'react';
import renderer from 'react-test-renderer';
import {View} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {ProIconChip} from '../src/components/ProIconChip';
import type {IconChipTone} from '../src/components/ProIconChip';
import {ProColors} from '../src/theme/professionalTheme';

const EXPECTED: Record<IconChipTone, {background: string; foreground: string}> = {
  navy: {background: ProColors.blueSoft, foreground: ProColors.primary},
  blue: {background: ProColors.blueSoft, foreground: '#2563EB'},
  amber: {background: ProColors.accentSoft, foreground: ProColors.accentText},
  green: {background: ProColors.successSoft, foreground: ProColors.success},
  red: {background: ProColors.errorSoft, foreground: ProColors.error},
  slate: {background: ProColors.slateSoft, foreground: '#52627A'},
};

it.each(Object.keys(EXPECTED) as IconChipTone[])('chip tone %s pairs a soft tint with a readable glyph', tone => {
  let screen!: renderer.ReactTestRenderer;
  renderer.act(() => {
    screen = renderer.create(<ProIconChip name="cash" tone={tone} />);
  });
  const chip = screen.root.findByType(View);
  const style = Array.isArray(chip.props.style) ? Object.assign({}, ...chip.props.style) : chip.props.style;
  expect(style.backgroundColor).toBe(EXPECTED[tone].background);
  const icon = screen.root.findByType(MaterialCommunityIcons);
  expect(icon.props.name).toBe('cash');
  expect(icon.props.color).toBe(EXPECTED[tone].foreground);
  expect(icon.props.size).toBe(24);
  renderer.act(() => screen.unmount());
});

it('sizes the block from the size prop', () => {
  let screen!: renderer.ReactTestRenderer;
  renderer.act(() => {
    screen = renderer.create(<ProIconChip name="cash" size={58} iconSize={30} />);
  });
  const chip = screen.root.findByType(View);
  const style = Array.isArray(chip.props.style) ? Object.assign({}, ...chip.props.style) : chip.props.style;
  expect(style.width).toBe(58);
  expect(style.height).toBe(58);
  expect(screen.root.findByType(MaterialCommunityIcons).props.size).toBe(30);
  renderer.act(() => screen.unmount());
});
