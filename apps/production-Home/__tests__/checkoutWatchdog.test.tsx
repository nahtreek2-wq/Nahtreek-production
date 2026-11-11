import React from 'react';
import renderer from 'react-test-renderer';
import {AppState} from 'react-native';
import {useCheckoutWatchdog} from '../../../packages/mobile-booking/useCheckoutWatchdog';

type Listener = (state: string) => void;
let listeners: Listener[];
let removeSpy: jest.Mock;

beforeEach(() => {
  listeners = [];
  removeSpy = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((event: string, handler: Listener) => {
    listeners.push(handler);
    return {remove: removeSpy};
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function Harness({active, watchKey, graceMs, onStall}: {active: boolean; watchKey: unknown; graceMs?: number; onStall: () => void}) {
  useCheckoutWatchdog(active, onStall, watchKey, graceMs);
  return null;
}

function renderHook(props: {active: boolean; watchKey: unknown; graceMs?: number; onStall: () => void}) {
  let screen!: renderer.ReactTestRenderer;
  renderer.act(() => {
    screen = renderer.create(<Harness {...props} />);
  });
  return screen;
}

const emit = (state: string) => {
  renderer.act(() => {
    listeners.forEach(listener => listener(state));
  });
};

it('fires once when foregrounding with a pending checkout', () => {
  const onStall = jest.fn();
  const screen = renderHook({active: true, watchKey: 1, graceMs: 0, onStall});
  emit('active');
  expect(onStall).toHaveBeenCalledTimes(1);
  emit('active');
  expect(onStall).toHaveBeenCalledTimes(1);
  renderer.act(() => screen.unmount());
  expect(removeSpy).toHaveBeenCalled();
});

it('stays silent without a pending checkout', () => {
  const onStall = jest.fn();
  const screen = renderHook({active: false, watchKey: 0, graceMs: 0, onStall});
  emit('active');
  emit('background');
  expect(onStall).not.toHaveBeenCalled();
  renderer.act(() => screen.unmount());
});

it('re-arms for each new checkout attempt', () => {
  const onStall = jest.fn();
  let screen!: renderer.ReactTestRenderer;
  renderer.act(() => {
    screen = renderer.create(<Harness active watchKey={1} graceMs={0} onStall={onStall} />);
  });
  emit('active');
  expect(onStall).toHaveBeenCalledTimes(1);
  renderer.act(() => {
    screen.update(<Harness active watchKey={2} onStall={onStall} graceMs={0} />);
  });
  emit('active');
  expect(onStall).toHaveBeenCalledTimes(2);
  renderer.act(() => screen.unmount());
});

it('ignores the open transition inside the grace window', () => {
  const onStall = jest.fn();
  const screen = renderHook({active: true, watchKey: 1, graceMs: 60000, onStall});
  emit('active');
  expect(onStall).not.toHaveBeenCalled();
  renderer.act(() => screen.unmount());
});
