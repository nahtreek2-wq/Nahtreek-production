import {__resetConfirmForTests, confirmDialog, useConfirmStore} from './confirm';

beforeEach(__resetConfirmForTests);

describe('confirmDialog store', () => {
  it('resolves true on confirm and clears the request', async () => {
    const pending = confirmDialog({title: 'Delete?', message: 'Gone forever.', confirmLabel: 'Delete', destructive: true});
    expect(useConfirmStore.getState().current).toMatchObject({title: 'Delete?', confirmLabel: 'Delete',
      cancelLabel: 'Cancel', destructive: true});
    useConfirmStore.getState().answer(true);
    await expect(pending).resolves.toBe(true);
    expect(useConfirmStore.getState().current).toBeNull();
  });

  it('resolves false on cancel', async () => {
    const pending = confirmDialog({title: 'Leave?', message: 'Stay a while.'});
    useConfirmStore.getState().answer(false);
    await expect(pending).resolves.toBe(false);
    expect(useConfirmStore.getState().current).toBeNull();
  });

  it('supports single-button dialogs without a cancel label', async () => {
    const pending = confirmDialog({title: 'Heads up', message: 'Read this.', confirmLabel: 'OK', cancelLabel: null});
    expect(useConfirmStore.getState().current).toMatchObject({confirmLabel: 'OK', cancelLabel: null});
    useConfirmStore.getState().answer(true);
    await expect(pending).resolves.toBe(true);
  });

  it('cancels the stale request when a new one arrives', async () => {
    const first = confirmDialog({title: 'First', message: 'one'});
    const second = confirmDialog({title: 'Second', message: 'two'});
    await expect(first).resolves.toBe(false);
    expect(useConfirmStore.getState().current).toMatchObject({title: 'Second'});
    useConfirmStore.getState().answer(true);
    await expect(second).resolves.toBe(true);
  });

  it('ignores answers with no pending request', () => {
    expect(() => useConfirmStore.getState().answer(true)).not.toThrow();
    expect(useConfirmStore.getState().current).toBeNull();
  });
});
