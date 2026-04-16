import React, { useEffect, useRef } from 'react';
import { Animated, Text, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToastStore } from '../../store/toastStore';
import { theme } from '../../constants/theme';

export function Toast() {
  const { message, type, visible, hide } = useToastStore();
  const translateY = useRef(new Animated.Value(-100)).current;
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) {
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 100,
        friction: 8,
      }).start();
      const timer = setTimeout(() => {
        Animated.timing(translateY, {
          toValue: -100,
          duration: 300,
          useNativeDriver: true,
        }).start(() => hide());
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [visible]);

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
      pointerEvents="none"
    >
      <Text style={styles.text}>{message}</Text>
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
  text: {
    color: '#FFFFFF',
    fontSize: theme.sizes.sm,
    fontWeight: '600',
    textAlign: 'center',
  },
});
