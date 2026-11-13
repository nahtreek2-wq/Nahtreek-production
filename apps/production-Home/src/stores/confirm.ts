import {create} from 'zustand';

export type ConfirmRequest = {
  id: number;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string | null;
  destructive: boolean;
};

export type AskConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string | null;
  destructive?: boolean;
};

interface ConfirmState {
  current: ConfirmRequest | null;
  resolve: ((value: boolean) => void) | null;
  ask: (options: AskConfirmOptions) => Promise<boolean>;
  answer: (value: boolean) => void;
}

let nextId = 1;

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  current: null,
  resolve: null,
  ask: options =>
    new Promise<boolean>(resolve => {
      // One dialog at a time, like the native alert: a new request while one
      // is open resolves the stale one as cancelled instead of stacking.
      const pending = get();
      pending.resolve?.(false);
      set({
        current: {
          id: nextId++,
          title: options.title,
          message: options.message,
          confirmLabel: options.confirmLabel ?? 'OK',
          cancelLabel: options.cancelLabel === undefined ? 'Cancel' : options.cancelLabel,
          destructive: options.destructive ?? false,
        },
        resolve,
      });
    }),
  answer: value => {
    const {current, resolve} = get();
    if (!current || !resolve) return;
    set({current: null, resolve: null});
    resolve(value);
  },
}));

// Branded replacement for Alert.alert: resolves true when the user confirms,
// false on cancel, backdrop tap or back button. Safe to call outside React.
export function confirmDialog(options: AskConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().ask(options);
}

export function __resetConfirmForTests() {
  useConfirmStore.setState({current: null, resolve: null});
}
