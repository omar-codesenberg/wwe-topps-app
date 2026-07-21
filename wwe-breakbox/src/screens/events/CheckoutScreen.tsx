import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EventsStackParamList } from '../../navigation/EventsStack';
import { ScreenBackground } from '../../components/ui/ScreenBackground';
import { AppHeader } from '../../components/ui/AppHeader';
import { HoldTimerBanner } from '../../components/ui/HoldTimerBanner';
import { SlotShowcaseCard } from '../../components/slots/SlotShowcaseCard';
import { WWEButton } from '../../components/ui/WWEButton';
import { LoadingOverlay } from '../../components/ui/LoadingOverlay';
import { useCountdown } from '../../hooks/useCountdown';
import { useAuthStore } from '../../store/authStore';
import { useCheckoutStore } from '../../store/checkoutStore';
import { useToastStore } from '../../store/toastStore';
import { releaseSlotOnCancel } from '../../services/functions.service';
import { purchaseSlotViaPayPal } from '../../services/payments/paypal.service';
import { theme } from '../../constants/theme';

type Props = NativeStackScreenProps<EventsStackParamList, 'Checkout'>;

export function CheckoutScreen({ route, navigation }: Props) {
  const { eventId, slotId, lockedUntil, slotData } = route.params;
  const insets = useSafeAreaInsets();
  const { show } = useToastStore();
  const { clear } = useCheckoutStore();
  const { user } = useAuthStore();
  const [isPurchasing, setIsPurchasing] = React.useState(false);
  const [isExpired, setIsExpired] = React.useState(false);

  const lockedUntilDate = useMemo(() => new Date(lockedUntil), [lockedUntil]);
  // Note: server-side, the slot lock is extended to 5 minutes once PayPal order is created.
  // This client-side countdown is now a UX hint, not a hard expiry.
  const { secondsRemaining } = useCountdown(lockedUntilDate, () => {
    setIsExpired(true);
    releaseSlot();
  });

  const priceLabel = `$${(slotData.priceCents / 100).toFixed(2)}`;

  const releaseSlot = async () => {
    try {
      await releaseSlotOnCancel({ eventId, slotId });
    } catch {
      // Lock will expire automatically
    }
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (isPurchasing) {
        e.preventDefault();
        return;
      }
      releaseSlot();
      clear();
    });
    return unsubscribe;
  }, [navigation, isPurchasing]);

  const handlePurchase = async () => {
    if (isExpired) {
      show('Your reservation expired. Please try again.', 'error');
      navigation.goBack();
      return;
    }
    if (!user) return;
    setIsPurchasing(true);
    try {
      const result = await purchaseSlotViaPayPal({ eventId, slotId });

      if (result.success) {
        clear();
        navigation.navigate('PurchaseSuccess', {
          purchaseId: result.purchaseId,
          slotData,
          eventTitle: 'WWE Topps Chrome 2026 Mega Break 3x',
          eventId,
        });
        return;
      }

      // success === false — handle each reason
      if (result.reason === 'CANCELLED') {
        // User dismissed the PayPal portal. Leave the slot lock and the open
        // PayPal order intact so the user can click PayPal again and resume
        // via the [S2] alreadyOpen path in createPayPalOrder. The lock keeps
        // its existing countdown; explicit cancel (Cancel button / back nav)
        // still releases via releaseSlot() in handleCancel / beforeRemove.
        return;
      }

      const fallbackByReason: Record<string, string> = {
        AMOUNT_MISMATCH: 'Payment amount did not match the slot price. Please try again.',
        SLOT_SOLD_OTHER: 'This slot was just purchased by someone else.',
        LOCK_EXPIRED: 'Your reservation expired. Please try again.',
        REFUND_DECIDED: 'Your payment was refunded. Please try again.',
        ORDER_VOIDED: 'The PayPal order was voided. Please try again.',
        NETWORK_ERROR: 'Network error. Please check your connection and try again.',
        UNKNOWN: 'Purchase failed. Please try again.',
      };
      const message = result.message || fallbackByReason[result.reason] || 'Purchase failed. Please try again.';
      show(message, 'error');
    } catch (e: any) {
      console.error('Purchase error:', e);
      show(e?.message || 'Purchase failed. Please try again.', 'error');
    } finally {
      setIsPurchasing(false);
    }
  };

  const handleCancel = async () => {
    await releaseSlot();
    clear();
    navigation.goBack();
  };

  return (
    <ScreenBackground>
      <LoadingOverlay visible={isPurchasing} />
      <AppHeader title="CHECKOUT" onBack={handleCancel} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        <SlotShowcaseCard slot={slotData} />

        {/* Hold timer */}
        {isExpired ? (
          <View style={styles.expired}>
            <Text style={styles.expiredTitle}>TIME EXPIRED</Text>
            <Text style={styles.expiredSub}>SLOT RELEASED</Text>
          </View>
        ) : (
          <HoldTimerBanner secondsRemaining={secondsRemaining} style={styles.banner} />
        )}

        {/* Order summary */}
        <View style={styles.summary}>
          <Text style={styles.summaryTitle}>ORDER SUMMARY</Text>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Slot · {slotData.wrestlerName}</Text>
            <Text style={styles.summaryValue}>{priceLabel}</Text>
          </View>
        </View>

        {/* Pay button */}
        {!isExpired ? (
          <>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handlePurchase}
              disabled={isPurchasing}
              style={[styles.payShadow, isPurchasing && styles.payDisabled]}
            >
              <LinearGradient
                colors={theme.gradients.redButton}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={styles.payBtn}
              >
                <View style={styles.payGloss} pointerEvents="none" />
                <Text style={styles.payText}>PAY {priceLabel}</Text>
                <View style={styles.payDivider} />
                <View style={styles.paypalChip}>
                  <Text style={styles.paypalPay}>Pay</Text>
                  <Text style={styles.paypalPal}>Pal</Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>
            <Text style={styles.fine}>YOU'LL CONFIRM SECURELY IN THE PAYPAL PORTAL</Text>
            <Text style={styles.fineDim}>POWERED BY PAYPAL · CARD PAYMENTS SUPPORTED</Text>
          </>
        ) : (
          <WWEButton label="GO BACK" onPress={() => navigation.goBack()} style={styles.goBack} />
        )}
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm },
  banner: { marginTop: theme.spacing.lg },
  expired: { alignItems: 'center', marginTop: theme.spacing.lg },
  expiredTitle: { color: theme.colors.red, fontSize: theme.sizes.xl, fontFamily: theme.fonts.display, letterSpacing: 2 },
  expiredSub: { color: theme.colors.textSecondary, fontSize: theme.sizes.sm, letterSpacing: 3, marginTop: 4 },
  summary: {
    marginTop: theme.spacing.lg,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    padding: theme.spacing.md,
  },
  summaryTitle: {
    color: theme.colors.textPrimary,
    fontSize: theme.sizes.sm,
    letterSpacing: 2,
    fontFamily: theme.fonts.display,
  },
  summaryDivider: { height: 1, backgroundColor: theme.colors.hairline, marginVertical: theme.spacing.sm },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { color: theme.colors.textSecondary, fontSize: theme.sizes.sm, fontFamily: theme.fonts.medium },
  summaryValue: { color: theme.colors.textPrimary, fontSize: theme.sizes.md, fontFamily: theme.fonts.heading },
  payShadow: {
    marginTop: theme.spacing.xl,
    borderRadius: theme.radius.sm,
    shadowColor: theme.colors.redGlow,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.95,
    shadowRadius: 18,
    elevation: 8,
  },
  payDisabled: { opacity: 0.6 },
  payBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    minHeight: 64,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.metalBorder,
    overflow: 'hidden',
  },
  payGloss: { position: 'absolute', top: 0, left: 0, right: 0, height: '45%', backgroundColor: 'rgba(255,255,255,0.18)' },
  payText: { color: '#FFFFFF', fontSize: theme.sizes.lg, fontFamily: theme.fonts.display, letterSpacing: 1 },
  payDivider: { width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.5)' },
  paypalChip: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: theme.radius.full,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  paypalPay: { color: '#003087', fontSize: theme.sizes.md, fontWeight: '800', fontStyle: 'italic' },
  paypalPal: { color: '#009CDE', fontSize: theme.sizes.md, fontWeight: '800', fontStyle: 'italic' },
  fine: {
    color: theme.colors.textSecondary,
    fontSize: theme.sizes.xs,
    textAlign: 'center',
    letterSpacing: 1,
    marginTop: theme.spacing.md,
    fontFamily: theme.fonts.medium,
  },
  fineDim: {
    color: theme.colors.textDimmed,
    fontSize: theme.sizes.xxs,
    textAlign: 'center',
    letterSpacing: 1,
    marginTop: 4,
    fontFamily: theme.fonts.medium,
  },
  goBack: { marginTop: theme.spacing.xl },
});
