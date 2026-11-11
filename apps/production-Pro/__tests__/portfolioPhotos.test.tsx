import React from 'react';
import renderer from 'react-test-renderer';
import {Alert} from 'react-native';

jest.mock('react-native-image-picker', () => ({launchImageLibrary: jest.fn()}));
jest.mock('../src/services/apiClient', () => ({api: {post: jest.fn(), delete: jest.fn()}}));
jest.mock('../src/stores/proToast', () => ({useProToast: () => jest.fn()}));

import {launchImageLibrary} from 'react-native-image-picker';
import {api} from '../src/services/apiClient';
import {usePortfolioPhotos} from '../src/hooks/usePortfolioPhotos';

const mockedPicker = launchImageLibrary as jest.Mock;
const mockedApi = api as unknown as {post: jest.Mock; delete: jest.Mock};

type HookReturn = ReturnType<typeof usePortfolioPhotos>;

function setup(refresh = jest.fn().mockResolvedValue(undefined)) {
  const ref: {current: HookReturn | null} = {current: null};
  function Probe() {
    ref.current = usePortfolioPhotos(refresh);
    return null;
  }
  let screen!: renderer.ReactTestRenderer;
  const render = async () => {
    await renderer.act(async () => {
      screen = renderer.create(<Probe />);
    });
  };
  const done = () => renderer.act(() => screen.unmount());
  return {render, done, hook: () => ref.current as HookReturn, refresh};
}

beforeEach(() => jest.clearAllMocks());

it('rejects short titles without opening the picker', async () => {
  const t = setup();
  await t.render();
  await renderer.act(async () => {
    await t.hook().addWorkPhoto();
  });
  expect(mockedPicker).not.toHaveBeenCalled();
  expect(t.hook().uploadError).toContain('short title');
  t.done();
});

it('uploads a picked photo and refreshes', async () => {
  mockedPicker.mockResolvedValue({assets: [{base64: 'aGVsbG8=', type: 'image/jpeg'}]});
  mockedApi.post.mockResolvedValue({id: 'p1'});
  const t = setup();
  await t.render();
  await renderer.act(async () => {
    t.hook().setPhotoTitle('Kitchen slab');
  });
  await renderer.act(async () => {
    await t.hook().addWorkPhoto();
  });
  expect(mockedApi.post).toHaveBeenCalledWith('/professionals/me/portfolio',
    {title: 'Kitchen slab', mimeType: 'image/jpeg', contentBase64: 'aGVsbG8='});
  expect(t.refresh).toHaveBeenCalled();
  expect(t.hook().uploadError).toBe('');
  t.done();
});

it('rejects oversized photos before upload', async () => {
  mockedPicker.mockResolvedValue({assets: [{base64: 'x'.repeat(1_333_337), type: 'image/jpeg'}]});
  const t = setup();
  await t.render();
  await renderer.act(async () => {
    t.hook().setPhotoTitle('Big slab');
  });
  await renderer.act(async () => {
    await t.hook().addWorkPhoto();
  });
  expect(mockedApi.post).not.toHaveBeenCalled();
  expect(t.hook().uploadError).toContain('1 MB');
  t.done();
});

it('removes after confirm and refreshes', async () => {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(((...args: unknown[]) => {
    const buttons = args[2] as {text: string; onPress?: () => void}[];
    buttons.find(button => button.text === 'Remove')?.onPress?.();
  }) as never);
  mockedApi.delete.mockResolvedValue({});
  const t = setup();
  await t.render();
  await renderer.act(async () => {
    t.hook().removePhoto('p1', 'Kitchen slab');
  });
  await renderer.act(async () => {
    await Promise.resolve();
  });
  expect(mockedApi.delete).toHaveBeenCalledWith('/professionals/me/portfolio/p1');
  expect(t.refresh).toHaveBeenCalled();
  alertSpy.mockRestore();
  t.done();
});
