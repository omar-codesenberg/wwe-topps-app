import 'dotenv/config';

// Region note: functions currently deploy to the default us-central1 region.
// To target a different region (e.g. us-east1), wrap each function with
// functions.region('us-east1').runWith({...}).https.onCall(...)
// or functions.region('us-east1').pubsub.schedule(...) in the individual files.
export { lockSlot } from './lockSlot';
export { purchaseSlot } from './purchaseSlot';
export { releaseSlotOnCancel } from './releaseSlotOnCancel';
export { releaseExpiredLocks } from './releaseExpiredLocks';

// PayPal integration (callables, webhook, and scheduled refund retry).
export { createPayPalOrder } from './paypal/createOrder';
export { capturePayPalOrder } from './paypal/captureOrder';
export { getPayPalOrderStatus } from './paypal/getOrderStatus';
export { paypalWebhook } from './paypal/webhook';
export { pendingRefundsRetry } from './paypal/pendingRefundsRetry';

// Admin-only callables (gated by `admin: true` custom claim).
export { createEventWithSlots } from './admin/createEventWithSlots';
export { startEvent } from './admin/startEvent';
export { closeEvent } from './admin/closeEvent';
export { setSlotClosed } from './admin/setSlotClosed';
export { setSlotBrand } from './admin/setSlotBrand';
export { setUserLegacy } from './admin/setUserLegacy';
