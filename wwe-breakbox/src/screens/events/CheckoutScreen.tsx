import React, { useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EventsStackParamList } from '../../navigation/EventsStack';
import { LockCountdown } from '../../components/slots/LockCountdown';
import { WWEButton } from '../../components/ui/WWEButton';
import { LoadingOverlay } from '../../components/ui/LoadingOverlay';
import { useCountdown } from '../../hooks/useCountdown';
import { useAuthStore } from '../../store/authStore';
import { useCheckoutStore } from '../../store/checkoutStore';
import { useToastStore } from '../../store/toastStore';
import { releaseSlotOnCancel } from '../../services/functions.service';
import {
  purchaseSlotViaPayPal,
  cancelPurchaseFlow,
} from '../../services/payments/paypal.service';
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
        // User knowingly cancelled in PayPal — no toast.
        // Best-effort cleanup of any open server-side state.
        try {
          await cancelPurchaseFlow({ eventId, slotId });
        } catch {
          // Cleanup is best-effort; lock will expire on its own.
        }
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
    <View style={[styles.container, { paddingBottom: insets.bottom + 16 }]}>
      <LoadingOverlay visible={isPurchasing} />

      <ScrollView contentContainerStyle={styles.content} bounces={false}>
        {/* Slot info */}
        <View style={styles.slotInfo}>
          <Text style={styles.wrestlerName}>{slotData.wrestlerName}</Text>
          {slotData.members.length > 0 && (
            <Text style={styles.members}>{slotData.members.join(' • ')}</Text>
          )}
          <Text style={styles.price}>${(slotData.priceCents / 100).toFixed(2)}</Text>
        </View>

        {/* Countdown */}
        <View style={styles.countdownSection}>
          {isExpired ? (
            <View style={styles.expiredContainer}>
              <Text style={styles.expiredTitle}>TIME EXPIRED</Text>
              <Text style={styles.expiredSub}>SLOT RELEASED</Text>
            </View>
          ) : (
            <>
              <Text style={styles.timerLabel}>RESERVATION EXPIRES IN</Text>
              <LockCountdown secondsRemaining={secondsRemaining} />
            </>
          )}
        </View>

        {/* One slot notice */}
        <Text style={styles.notice}>ONE SPOT PER TRANSACTION</Text>

        {/* Fake PayPal button */}
        {!isExpired && (
          <TouchableOpacity
            style={[styles.paypalButton, isPurchasing && styles.paypalDisabled]}
            onPress={handlePurchase}
            disabled={isPurchasing}
            activeOpacity={0.85}
          >
            <View style={styles.paypalInner}>
              <Text style={styles.paypalText}>Pay</Text>
              <Text style={[styles.paypalText, styles.paypalBold]}>Pal</Text>
            </View>
            <Text style={styles.paypalSub}>SECURE PAYMENT WITH PAYPAL</Text>
            {/* TODO: Replace with PayPal SDK integration */}
          </TouchableOpacity>
        )}

        {isExpired ? (
          <WWEButton label="Go Back" onPress={() => navigation.goBack()} style={styles.cancelBtn} />
        ) : (
          <WWEButton
            label="Cancel"
            onPress={handleCancel}
            variant="outline"
            style={styles.cancelBtn}
            disabled={isPurchasing}
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { flexGrow: 1, paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg },
  slotInfo: { alignItems: 'center', marginBottom: theme.spacing.xl },
  wrestlerName: {
    color: theme.colors.textPrimary,
    fontSize: theme.sizes.xl,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 6,
    fontFamily: 'Oswald_700Bold',
  },
  members: {
    color: theme.colors.textSecondary,
    fontSize: theme.sizes.xs,
    textAlign: 'center',
    marginBottom: theme.spacing.sm,
  },
  price: {
    color: theme.colors.gold,
    fontSize: 42,
    fontWeight: '900',
    marginTop: theme.spacing.md,
    fontFamily: 'Oswald_700Bold',
  },
  countdownSection: { alignItems: 'center', marginBottom: theme.spacing.xl },
  timerLabel: {
    color: theme.colors.textSecondary,
    fontSize: theme.sizes.xs,
    letterSpacing: 3,
    marginBottom: theme.spacing.md,
  },
  expiredContainer: { alignItems: 'center' },
  expiredTitle: { color: theme.colors.red, fontSize: theme.sizes.xl, fontWeight: '900', letterSpacing: 4 },
  expiredSub: { color: theme.colors.textSecondary, fontSize: theme.sizes.sm, letterSpacing: 3, marginTop: 4 },
  notice: {
    color: theme.colors.textSecondary,
    fontSize: theme.sizes.xs,
    letterSpacing: 3,
    textAlign: 'center',
    marginBottom: theme.spacing.lg,
  },
  paypalButton: {
    backgroundColor: '#0070BA',
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  paypalDisabled: { opacity: 0.6 },
  paypalInner: { flexDirection: 'row' },
  paypalText: { color: '#FFFFFF', fontSize: 22, fontWeight: '400', fontStyle: 'italic' },
  paypalBold: { fontWeight: '700', color: '#009CDE' },
  paypalSub: { color: 'rgba(255,255,255,0.8)', fontSize: theme.sizes.xs, letterSpacing: 2, marginTop: 4 },
  cancelBtn: { marginTop: theme.spacing.sm },
});
