import React, { useEffect, useCallback } from 'react';
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
import { TierBadge } from '../../components/ui/TierBadge';
import { WWEButton } from '../../components/ui/WWEButton';
import { LoadingOverlay } from '../../components/ui/LoadingOverlay';
import { useCountdown } from '../../hooks/useCountdown';
import { useAuthStore } from '../../store/authStore';
import { useCheckoutStore } from '../../store/checkoutStore';
import { useToastStore } from '../../store/toastStore';
import { useWalletStore } from '../../store/walletStore';
import { purchaseSlot, releaseSlotOnCancel } from '../../services/functions.service';
import { BRAND_CONFIG } from '../../constants/brands';
import { theme } from '../../constants/theme';

type Props = NativeStackScreenProps<EventsStackParamList, 'Checkout'>;

export function CheckoutScreen({ route, navigation }: Props) {
  const { eventId, slotId, lockedUntil, slotData } = route.params;
  const insets = useSafeAreaInsets();
  const { show } = useToastStore();
  const { clear } = useCheckoutStore();
  const { user } = useAuthStore();
  const { balance } = useWalletStore();
  const canAfford = balance >= slotData.price;
  const [isPurchasing, setIsPurchasing] = React.useState(false);
  const [isExpired, setIsExpired] = React.useState(false);
  const brandConfig = BRAND_CONFIG[slotData.brand];

  const lockedUntilDate = new Date(lockedUntil);
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
    // TODO: Re-enable funds check for production
    // if (!canAfford) {
    //   show('Insufficient funds.', 'error');
    //   return;
    // }
    setIsPurchasing(true);
    try {
      const result = await purchaseSlot({ eventId, slotId });
      const data = result.data as { success: boolean; purchaseId?: string; reason?: string };
      if (!data.success) {
        const message =
          data.reason === 'LOCK_EXPIRED' ? 'Your reservation expired. Please try again.' :
          data.reason === 'SLOT_NOT_LOCKED' ? 'This slot is no longer reserved.' :
          data.reason === 'NOT_YOUR_LOCK' ? 'This slot is reserved by another user.' :
          'Purchase failed. Please try again.';
        show(message, 'error');
        return;
      }

      clear();
      navigation.navigate('PurchaseSuccess', {
        purchaseId: data.purchaseId!,
        slotData,
        eventTitle: 'WWE Topps Chrome 2026 Mega Break 3x',
      });
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
        {/* Brand header */}
        <View style={[styles.brandHeader, { backgroundColor: brandConfig.bgColor }]}>
          <Text style={[styles.brandLabel, { color: brandConfig.color }]}>
            {brandConfig.label}
          </Text>
        </View>

        {/* Slot info */}
        <View style={styles.slotInfo}>
          <Text style={styles.wrestlerName}>{slotData.wrestlerName}</Text>
          {slotData.members.length > 0 && (
            <Text style={styles.members}>{slotData.members.join(' • ')}</Text>
          )}
          <TierBadge tier={slotData.tier} size="md" />
          <Text style={styles.price}>${slotData.price.toLocaleString()}.00</Text>
        </View>

        {/* Balance */}
        <View style={styles.balanceRow}>
          <Text style={styles.balanceLabel}>YOUR BALANCE</Text>
          <Text style={[styles.balanceAmount, !canAfford && styles.balanceInsufficient]}>
            ${balance.toLocaleString()}.00
          </Text>
          {!canAfford && (
            <Text style={styles.insufficientText}>INSUFFICIENT FUNDS</Text>
          )}
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
  content: { flexGrow: 1, paddingHorizontal: theme.spacing.lg },
  brandHeader: {
    marginHorizontal: -theme.spacing.lg,
    paddingVertical: 10,
    paddingHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.lg,
  },
  brandLabel: { fontSize: theme.sizes.xs, fontWeight: '900', letterSpacing: 4 },
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
  balanceRow: {
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  balanceLabel: {
    color: theme.colors.textSecondary,
    fontSize: theme.sizes.xs,
    letterSpacing: 3,
    marginBottom: 4,
  },
  balanceAmount: {
    color: theme.colors.success,
    fontSize: theme.sizes.lg,
    fontWeight: '900',
    fontFamily: 'Oswald_700Bold',
  },
  balanceInsufficient: {
    color: theme.colors.red,
  },
  insufficientText: {
    color: theme.colors.red,
    fontSize: theme.sizes.xs,
    letterSpacing: 2,
    marginTop: 4,
  },
  cancelBtn: { marginTop: theme.spacing.sm },
});
