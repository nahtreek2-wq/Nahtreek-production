import {useBottomTabBarHeight} from '@react-navigation/bottom-tabs';

// Screens registered both as a tab and as a stack route (Find) must not
// crash on the stack path, where no tab bar exists and the raw hook throws.
// Stack callers get zero inset instead of an error page.
export function useOptionalTabBarHeight(): number {
  try {
    return useBottomTabBarHeight();
  } catch {
    return 0;
  }
}
