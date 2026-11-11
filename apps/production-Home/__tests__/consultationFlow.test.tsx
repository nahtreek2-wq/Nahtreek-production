import React from 'react';
import {Text} from 'react-native';
import renderer from 'react-test-renderer';
import type {EngineerProfileDto, EngineerRequestDto} from '@nahtreek/types';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));
jest.mock('../src/components/LocationPicker', () => {
  const RN = jest.requireActual('react-native');
  return {
    LocationPicker: ({onSelect}: {onSelect: (item: unknown) => void}) => (
      <RN.Text
        testID="mock-pick-location"
        onPress={() =>
          onSelect({
            address: '21 Anna Nagar, Chennai',
            city: 'Chennai',
            state: 'Tamil Nadu',
            latitude: 13.08,
            longitude: 80.27,
          })
        }>
        pick
      </RN.Text>
    ),
  };
});

import {ConsultationSheet, type ConsultationPayload} from '../src/components/ConsultationSheet';
import {Input} from '../src/components/ui/Input';

const engineer = {
  fullName: 'Arun Prakash',
  consultationFeePaisa: 49900,
  specializations: ['Structural Design', 'Site Plan Approval'],
} as EngineerProfileDto;

function texts(screen: renderer.ReactTestRenderer): string[] {
  return screen.root.findAllByType(Text).map(node => {
    const children = node.props.children;
    return Array.isArray(children) ? children.join('') : String(children ?? '');
  });
}

function pressLabel(screen: renderer.ReactTestRenderer, label: string) {
  const target = screen.root.findByProps({accessibilityLabel: label});
  renderer.act(() => target.props.onPress());
}

describe('ConsultationSheet booking flow', () => {
  it('walks 5 steps and submits with the collected payload', async () => {
    const onCreate = jest.fn(async (payload: ConsultationPayload) => ({
      id: 'req-1',
      projectTitle: payload.projectTitle,
      engineerName: 'Arun Prakash',
      createdAt: '2026-10-30T14:00:00.000Z',
    })) as unknown as (payload: ConsultationPayload) => Promise<EngineerRequestDto>;
    const onTrack = jest.fn();
    let screen!: renderer.ReactTestRenderer;
    await renderer.act(async () => {
      screen = renderer.create(
        <ConsultationSheet
          engineer={engineer}
          onClose={jest.fn()}
          onTrack={onTrack}
          onCreate={onCreate}
        />,
      );
    });

    expect(texts(screen)).toContain('STEP 1 OF 5');
    pressLabel(screen, 'Next');

    expect(texts(screen)).toContain('STEP 2 OF 5');
    const pick = screen.root.findByProps({testID: 'mock-pick-location'});
    await renderer.act(async () => pick.props.onPress());
    pressLabel(screen, 'Next');

    expect(texts(screen)).toContain('STEP 3 OF 5');
    const titleInput = screen.root.findAllByType(Input).find(node => node.props.label === 'Request title')!;
    const descInput = screen.root.findAllByType(Input).find(node => node.props.label === 'What needs to be done?')!;
    await renderer.act(async () => titleInput.props.onChangeText('Wall crack inspection'));
    await renderer.act(async () => descInput.props.onChangeText('Large diagonal crack in the living room wall.'));
    pressLabel(screen, 'Next');

    expect(texts(screen)).toContain('STEP 4 OF 5');
    pressLabel(screen, 'Next');

    expect(texts(screen)).toContain('STEP 5 OF 5');
    expect(texts(screen)).toContain('Review and send');
    expect(texts(screen)).toContain('Wall crack inspection');
    const send = screen.root.findByProps({accessibilityLabel: 'Send request'});
    await renderer.act(async () => send.props.onPress());

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectTitle: 'Wall crack inspection',
        propertyType: 'Residential',
        locationAddress: '21 Anna Nagar, Chennai',
        latitude: 13.08,
        longitude: 80.27,
      }),
    );
    expect(texts(screen)).toContain('Request submitted');
    pressLabel(screen, 'View request');
    expect(onTrack).toHaveBeenCalledWith('req-1');
  });

  it('blocks advancing with guidance when a step is invalid', async () => {
    const onCreate = jest.fn();
    let screen!: renderer.ReactTestRenderer;
    await renderer.act(async () => {
      screen = renderer.create(
        <ConsultationSheet
          engineer={engineer}
          onClose={jest.fn()}
          onTrack={jest.fn()}
          onCreate={onCreate}
        />,
      );
    });
    pressLabel(screen, 'Next');
    pressLabel(screen, 'Next');
    expect(texts(screen)).toContain('STEP 2 OF 5');
    expect(texts(screen).some(line => line.includes('Select a location'))).toBe(true);
    expect(onCreate).not.toHaveBeenCalled();
  });
});
