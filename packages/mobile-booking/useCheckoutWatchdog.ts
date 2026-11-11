import {useEffect, useRef} from 'react';
import {AppState} from 'react-native';

// Watches an open Razorpay checkout for a lost result: the SDK promise can
// hang forever (no success, no cancel, no error) if its activity dies
// abnormally. When that happens the user lands back on our screen with the
// mutation still pending and every button disabled — a "frozen" payment
// page. The recovery: the moment our screen is foregrounded again with a
// checkout still pending, the caller reconciles with the server (settle if
// money moved, otherwise reset to a retryable state).
//
// Safety: the grace window ignores the open transition itself; the one-shot
// guard fires once per checkout; and a late-arriving real result still
// flows through the normal idempotent verify path, so recovery can never
// double-charge or swallow a success.
export function useCheckoutWatchdog(active: boolean, onStall: () => void, watchKey: unknown = null, graceMs = 5000) {
  const activeRef = useRef(active);
  activeRef.current = active;
  const onStallRef = useRef(onStall);
  onStallRef.current = onStall;
  const openedAt = useRef(0);
  const openSeq = useRef(0);
  const firedSeq = useRef(-1);
  useEffect(() => {
    if (active) {
      openedAt.current = Date.now();
      // Monotonic, not timestamp-based: two opens inside one millisecond
      // must still re-arm (timestamps would collide and swallow the retry).
      openSeq.current += 1;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, watchKey]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active' || !activeRef.current) return;
      if (Date.now() - openedAt.current < graceMs) return;
      if (firedSeq.current === openSeq.current) return;
      firedSeq.current = openSeq.current;
      onStallRef.current();
    });
    return () => subscription.remove();
  }, [graceMs]);
}
