import React, { useEffect, useRef } from 'react';
import { Animated, Text, StyleSheet, Pressable, View, AccessibilityInfo } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToastStore } from '../../store/toastStore';
import { theme } from '../../constants/theme';

// Non-error toasts (info/success) auto-dismiss after this delay. Error toasts
// stay on screen until the user dismisses them — they convey information the
// user often needs to read carefully (declined payment, expired reservation,
// validation issues) and a 3s flash is not enough time.
const AUTO_DISMISS_MS = 3000;

export function Toast() {
  const { message, type, visible, hide } = useToastStore();
  const translateY = useRef(new Animated.Value(-100)).current;
  const insets = useSafeAreaInsets();

  const isError = type === 'error';

  useEffect(() => {
    if (!visible) return;

    // Slide-in animation runs for every toast.
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      tension: 100,
      friction: 8,
    }).start();

    // Errors stay on screen until manually dismissed — no auto-dismiss timer.
    if (isError) {
      // Announce the error via the platform screen reader (accessibility).
      AccessibilityInfo.announceForAccessibility?.(message);
      return;
    }

    // Non-error toasts auto-dismiss after AUTO_DISMISS_MS.
    const timer = setTimeout(() => {
      Animated.timing(translateY, {
        toValue: -100,
        duration: 300,
        useNativeDriver: true,
      }).start(() => hide());
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
    // Mirror the previous effect's deps: only re-run when visibility flips.
    // `isError`, `message`, `hide`, `translateY` are captured at show-time;
    // adding them as deps would re-trigger the slide-in animation on every
    // toast-content change while visible, causing visible jitter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleDismiss = (): void => {
    Animated.timing(translateY, {
      toValue: -100,
      duration: 200,
      useNativeDriver: true,
    }).start(() => hide());
  };

  const bgColor =
    type === 'error'
      ? theme.colors.error
      : type === 'success'
      ? theme.colors.success
      : '#333333';

  return (
    <Animated.View
      style={[
        styles.container,
        { top: insets.top + 8, backgroundColor: bgColor },
        { transform: [{ translateY }] },
      ]}
      // Errors are interactive (need to receive the close-button tap);
      // non-errors stay non-interactive so they don't intercept taps on
      // underlying UI during their brief 3s lifetime.
      pointerEvents={isError ? 'box-none' : 'none'}
      accessibilityRole={isError ? 'alert' : 'text'}
      accessibilityLiveRegion={isError ? 'assertive' : 'polite'}
    >
      <View style={styles.row}>
        <Text style={styles.text}>{message}</Text>
        {isError && (
          <Pressable
            onPress={handleDismiss}
            hitSlop={12}
            style={({ pressed }) => [
              styles.closeButton,
              pressed && styles.closeButtonPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Dismiss error"
          >
            <Text style={styles.closeText}>×</Text>
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9999,
    borderRadius: theme.radius.sm,
    paddingVertical: 12,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  text: {
    color: '#FFFFFF',
    fontSize: theme.sizes.sm,
    fontWeight: '600',
    textAlign: 'left',
    flex: 1,
  },
  closeButton: {
    marginLeft: 12,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  closeButtonPressed: {
    backgroundColor: 'rgba(255,255,255,0.32)',
  },
  closeText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 22,
  },
});
