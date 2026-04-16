import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EventsStackParamList } from '../../navigation/EventsStack';
import { TierBadge } from '../../components/ui/TierBadge';
import { WWEButton } from '../../components/ui/WWEButton';
import { BRAND_CONFIG } from '../../constants/brands';
import { theme } from '../../constants/theme';

type Props = NativeStackScreenProps<EventsStackParamList, 'PurchaseSuccess'>;

// Simple confetti particle
function Particle({ delay, x }: { delay: number; x: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  const colors = [theme.colors.red, theme.colors.gold, '#FFFFFF', '#22C55E', '#0070BA'];
  const color = colors[Math.floor(Math.random() * colors.length)];

  useEffect(() => {
    Animated.sequence([
      Animated.delay(delay),
      Animated.timing(anim, { toValue: 1, duration: 1500, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        top: 0,
        left: `${x}%` as any,
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: color,
        opacity: anim.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }),
        transform: [
          { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, 600] }) },
          { rotate: anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '720deg'] }) },
        ],
      }}
    />
  );
}

export function PurchaseSuccessScreen({ route, navigation }: Props) {
  const { slotData, eventTitle } = route.params;
  const insets = useSafeAreaInsets();
  const brandConfig = BRAND_CONFIG[slotData.brand];

  const particles = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    delay: Math.random() * 500,
    x: Math.random() * 90 + 5,
  }));

  useEffect(() => {
    const timer = setTimeout(() => {
      navigation.popToTop();
    }, 3500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 24 }]}>
      {/* Confetti */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {particles.map((p) => (
          <Particle key={p.id} delay={p.delay} x={p.x} />
        ))}
      </View>

      <View style={styles.content}>
        <Text style={styles.claimed}>YOU CLAIMED IT!</Text>

        <View style={[styles.card, { borderColor: brandConfig.color }]}>
          <View style={[styles.cardHeader, { backgroundColor: brandConfig.bgColor }]}>
            <Text style={[styles.brandLabel, { color: brandConfig.color }]}>
              {brandConfig.label}
            </Text>
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.wrestlerName}>{slotData.wrestlerName}</Text>
            {slotData.members.length > 0 && (
              <Text style={styles.members}>{slotData.members.join(' • ')}</Text>
            )}
            <TierBadge tier={slotData.tier} size="md" />
            <Text style={styles.price}>${slotData.price.toLocaleString()}.00</Text>
          </View>
        </View>

        <Text style={styles.eventTitle}>{eventTitle}</Text>
        <Text style={styles.sub}>Your slot has been confirmed!</Text>

        <WWEButton
          label="View My Purchases"
          onPress={() => {
            navigation.getParent()?.navigate('MyPurchases');
          }}
          style={styles.button}
        />
        <WWEButton
          label="Back to Roster"
          onPress={() => navigation.popToTop()}
          variant="outline"
          style={styles.secondBtn}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
  claimed: {
    color: theme.colors.gold,
    fontSize: theme.sizes.xl,
    fontWeight: '900',
    letterSpacing: 4,
    marginBottom: theme.spacing.xl,
    fontFamily: 'Oswald_700Bold',
  },
  card: {
    width: '100%',
    borderRadius: theme.radius.md,
    borderWidth: 2,
    overflow: 'hidden',
    backgroundColor: theme.colors.glassBg,
    marginBottom: theme.spacing.lg,
  },
  cardHeader: { paddingHorizontal: theme.spacing.md, paddingVertical: 8 },
  brandLabel: { fontSize: theme.sizes.xs, fontWeight: '900', letterSpacing: 4 },
  cardBody: { padding: theme.spacing.md, alignItems: 'flex-start', gap: 8 },
  wrestlerName: { color: theme.colors.textPrimary, fontSize: theme.sizes.lg, fontWeight: '900', fontFamily: 'Oswald_700Bold' },
  members: { color: theme.colors.textSecondary, fontSize: theme.sizes.xs },
  price: { color: theme.colors.gold, fontSize: theme.sizes.xl, fontWeight: '900' },
  eventTitle: { color: theme.colors.textSecondary, fontSize: theme.sizes.xs, letterSpacing: 2, marginBottom: 4 },
  sub: { color: theme.colors.success, fontSize: theme.sizes.sm, fontWeight: '700', marginBottom: theme.spacing.xl },
  button: { width: '100%', marginBottom: theme.spacing.sm },
  secondBtn: { width: '100%' },
});
