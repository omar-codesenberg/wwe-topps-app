import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import {
  createPayPalOrder,
  capturePayPalOrder,
  getPayPalOrderStatus,
} from '../functions.service';

export type PurchaseSlotResult =
  | { success: true; purchaseId: string }
  | {
      success: false;
      reason:
        | 'CANCELLED'
        | 'AMOUNT_MISMATCH'
        | 'SLOT_SOLD_OTHER'
        | 'LOCK_EXPIRED'
        | 'REFUND_DECIDED'
        | 'ORDER_VOIDED'
        | 'NETWORK_ERROR'
        | 'UNKNOWN';
      message?: string;
    };

export interface PurchaseSlotInput {
  eventId: string;
  slotId: string;
}

/**
 * Drives the full PayPal payment for a slot:
 *   1. Creates PayPal order via callable.
 *   2. Opens approval URL in WebBrowser.
 *   3. Parses deep-link return.
 *   4. Validates `token` URL param via getPayPalOrderStatus (S6).
 *   5. Calls capturePayPalOrder.
 */
export async function purchaseSlotViaPayPal(
  input: PurchaseSlotInput
): Promise<PurchaseSlotResult> {
  // 1. Create PayPal order on the server.
  let orderId: string;
  let approveUrl: string;
  try {
    const createResult = await createPayPalOrder({
      eventId: input.eventId,
      slotId: input.slotId,
    });
    orderId = createResult.data.orderId;
    approveUrl = createResult.data.approveUrl;
  } catch (err: any) {
    return {
      success: false,
      reason: 'NETWORK_ERROR',
      message: err?.message ?? 'Failed to create PayPal order',
    };
  }

  // 2. Build the deep-link return URL. Linking.createURL picks the right scheme
  //    from app.config.js automatically.
  const returnUrl = Linking.createURL('paypal/return');

  // 3. Open the PayPal approval flow in a system web auth session.
  let browserResult: WebBrowser.WebBrowserAuthSessionResult;
  try {
    browserResult = await WebBrowser.openAuthSessionAsync(approveUrl, returnUrl);
  } catch (err: any) {
    return {
      success: false,
      reason: 'NETWORK_ERROR',
      message: err?.message ?? 'Failed to open PayPal approval',
    };
  }

  if (browserResult.type !== 'success' || !browserResult.url) {
    // 'cancel' | 'dismiss' | 'locked' — user did not complete approval.
    return { success: false, reason: 'CANCELLED' };
  }

  // 4. Parse the deep-link return URL: PayPal appends ?token=<orderId>&PayerID=...
  const parsed = Linking.parse(browserResult.url);
  const rawToken = parsed.queryParams?.token;
  const token = typeof rawToken === 'string' ? rawToken : undefined;

  if (!token) {
    return {
      success: false,
      reason: 'UNKNOWN',
      message: 'missing_deep_link_token',
    };
  }

  // 5. S6 validation: if the token in the deep-link doesn't match the order we
  //    just created (rare — happens only if the user has two checkouts open),
  //    confirm via the server before trusting it.
  if (token !== orderId) {
    try {
      await getPayPalOrderStatus({ orderId: token });
    } catch {
      return {
        success: false,
        reason: 'UNKNOWN',
        message: 'deep_link_token_mismatch',
      };
    }
  }

  // 6. Capture the order on the server.
  let captureData: {
    success: boolean;
    purchaseId?: string;
    reason?: string;
    refundStatus?: { status: string; paypalRefundId?: string };
  };
  try {
    const captureResult = await capturePayPalOrder({ orderId: token });
    captureData = captureResult.data;
  } catch (err: any) {
    return {
      success: false,
      reason: 'NETWORK_ERROR',
      message: err?.message ?? 'Failed to capture PayPal order',
    };
  }

  if (captureData.success && captureData.purchaseId) {
    return { success: true, purchaseId: captureData.purchaseId };
  }

  // 7. Map known server-side failure reasons to user-facing messages.
  switch (captureData.reason) {
    case 'AMOUNT_MISMATCH':
      return {
        success: false,
        reason: 'AMOUNT_MISMATCH',
        message:
          'The price changed during checkout — your payment was refunded.',
      };
    case 'SLOT_SOLD_OTHER':
      return {
        success: false,
        reason: 'SLOT_SOLD_OTHER',
        message:
          'Someone else bought this slot first — your payment was refunded.',
      };
    case 'LOCK_EXPIRED':
      return {
        success: false,
        reason: 'LOCK_EXPIRED',
        message:
          'Your slot reservation expired during checkout — your payment was refunded.',
      };
    case 'REFUND_DECIDED':
      return {
        success: false,
        reason: 'REFUND_DECIDED',
        message: 'A refund is already in progress for this payment.',
      };
    case 'ORDER_VOIDED':
      return { success: false, reason: 'ORDER_VOIDED' };
    default:
      return {
        success: false,
        reason: 'UNKNOWN',
        message: captureData.reason,
      };
  }
}

