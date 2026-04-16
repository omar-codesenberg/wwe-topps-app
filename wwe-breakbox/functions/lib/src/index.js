"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.releaseExpiredLocks = exports.releaseSlotOnCancel = exports.purchaseSlot = exports.lockSlot = void 0;
// Region note: functions currently deploy to the default us-central1 region.
// To target a different region (e.g. us-east1), wrap each function with
// functions.region('us-east1').runWith({...}).https.onCall(...)
// or functions.region('us-east1').pubsub.schedule(...) in the individual files.
var lockSlot_1 = require("./lockSlot");
Object.defineProperty(exports, "lockSlot", { enumerable: true, get: function () { return lockSlot_1.lockSlot; } });
var purchaseSlot_1 = require("./purchaseSlot");
Object.defineProperty(exports, "purchaseSlot", { enumerable: true, get: function () { return purchaseSlot_1.purchaseSlot; } });
var releaseSlotOnCancel_1 = require("./releaseSlotOnCancel");
Object.defineProperty(exports, "releaseSlotOnCancel", { enumerable: true, get: function () { return releaseSlotOnCancel_1.releaseSlotOnCancel; } });
var releaseExpiredLocks_1 = require("./releaseExpiredLocks");
Object.defineProperty(exports, "releaseExpiredLocks", { enumerable: true, get: function () { return releaseExpiredLocks_1.releaseExpiredLocks; } });
//# sourceMappingURL=index.js.map