import { createNavigationContainerRef } from '@react-navigation/native';

// Used to imperatively navigate from outside React components — currently to
// auto-resume Checkout when an active slot lock is found at app startup.
export const navigationRef = createNavigationContainerRef<any>();
