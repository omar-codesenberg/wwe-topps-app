"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeError = safeError;
exports.info = info;
exports.warn = warn;
exports.error = error;
exports.withCorrelationId = withCorrelationId;
exports.project = project;
const v2_1 = require("firebase-functions/v2");
/**
 * Structured logger wrapper around `firebase-functions/v2` logger.
 *
 * Enforces:
 *   [C11] Redaction of sensitive keys (`config`, `headers`, `request`, `response`,
 *         `Authorization`, `authorization`, anything matching /token/i) on any
 *         object payload before it reaches `firebase-functions/logger`.
 *   [S8]  Allow-list projection helper (`project`) used by the PayPal client
 *         boundary to reduce success-path responses to a known-safe shape
 *         before they enter the log pipeline.
 *   [S16] `withCorrelationId` returns a scoped logger that injects
 *         `correlationId` into every payload.
 *
 * Callers MUST pass an event name as the first argument and a structured
 * object payload as the second argument. String interpolation is intentionally
 * unsupported (defends against log injection from PayPal-supplied fields).
 */
// Keys whose values are stripped from any object encountered during sanitization.
const SENSITIVE_KEYS = new Set([
    'config',
    'headers',
    'request',
    'response',
    'Authorization',
    'authorization',
]);
// Pattern for keys whose values are stripped regardless of casing (e.g. `accessToken`,
// `refresh_token`, `id_token`).
const SENSITIVE_KEY_PATTERN = /token/i;
// Maximum recursion depth for redaction. Caps work and defends against cycles.
const MAX_REDACT_DEPTH = 5;
// Fields we deliberately preserve on Error-shaped values when sanitizing.
const SAFE_ERROR_FIELDS = [
    'message',
    'name',
    'stack',
    'status',
    'code',
    'debugId',
    'paypalCode',
];
function isPlainObject(value) {
    if (value === null || typeof value !== 'object')
        return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}
function isSensitiveKey(key) {
    if (SENSITIVE_KEYS.has(key))
        return true;
    if (SENSITIVE_KEY_PATTERN.test(key))
        return true;
    return false;
}
/**
 * Recursively strip sensitive keys from a value. Returns a new value; never
 * mutates the input. Anything that isn't a plain object or array is passed
 * through unchanged (primitives, Dates, etc.). Errors are converted to a POJO
 * via `safeError`.
 */
function redact(value, depth) {
    if (depth > MAX_REDACT_DEPTH) {
        return '[Redacted: max depth]';
    }
    if (value === null || value === undefined)
        return value;
    // Errors get the dedicated POJO treatment so message/name/stack survive.
    if (value instanceof Error) {
        return safeError(value);
    }
    if (Array.isArray(value)) {
        return value.map((item) => redact(item, depth + 1));
    }
    if (isPlainObject(value)) {
        const out = {};
        for (const [key, child] of Object.entries(value)) {
            if (isSensitiveKey(key))
                continue;
            out[key] = redact(child, depth + 1);
        }
        return out;
    }
    // Primitives and exotic objects (Date, Buffer, etc.) — pass through.
    return value;
}
/**
 * Convert an arbitrary error/value into a plain object suitable for logging.
 * Strips sensitive fields (auth headers, request/response bodies, anything
 * matching /token/i) and preserves only safe error metadata plus other
 * non-sensitive primitive fields.
 */
function safeError(err) {
    if (err === null || err === undefined) {
        return { message: String(err) };
    }
    if (err instanceof Error) {
        const out = {};
        // Pull the canonical safe fields off the Error instance.
        for (const field of SAFE_ERROR_FIELDS) {
            const v = err[field];
            if (v !== undefined)
                out[field] = v;
        }
        // Then walk own-enumerable properties for any extra non-sensitive fields
        // (e.g. axios attaches `code`, custom errors attach `debugId`, etc.).
        for (const key of Object.keys(err)) {
            if (key in out)
                continue;
            if (isSensitiveKey(key))
                continue;
            const v = err[key];
            out[key] = redact(v, 1);
        }
        return out;
    }
    if (isPlainObject(err)) {
        const redacted = redact(err, 0);
        if (isPlainObject(redacted))
            return redacted;
        return { value: redacted };
    }
    if (typeof err === 'string') {
        return { message: err };
    }
    // Numbers, booleans, symbols, bigints, exotic objects — wrap.
    return { value: String(err) };
}
function sanitizePayload(payload) {
    if (payload === undefined)
        return undefined;
    const redacted = redact(payload, 0);
    return isPlainObject(redacted) ? redacted : { value: redacted };
}
function info(event, payload) {
    const safe = sanitizePayload(payload);
    if (safe === undefined) {
        v2_1.logger.info(event);
    }
    else {
        v2_1.logger.info(event, safe);
    }
}
function warn(event, payload) {
    const safe = sanitizePayload(payload);
    if (safe === undefined) {
        v2_1.logger.warn(event);
    }
    else {
        v2_1.logger.warn(event, safe);
    }
}
function error(event, errOrPayload, extraPayload) {
    var _a;
    const extra = (_a = sanitizePayload(extraPayload)) !== null && _a !== void 0 ? _a : {};
    if (errOrPayload === undefined) {
        if (Object.keys(extra).length === 0) {
            v2_1.logger.error(event);
        }
        else {
            v2_1.logger.error(event, extra);
        }
        return;
    }
    // If caller passed an Error/unknown error-shaped value, normalize via safeError.
    // Plain objects also flow through `safeError` so their sensitive keys get stripped.
    const errorPart = safeError(errOrPayload);
    v2_1.logger.error(event, Object.assign(Object.assign({}, extra), { error: errorPart }));
}
/**
 * [S16] Returns a logger with `correlationId` pre-bound. Every payload emitted
 * through the returned logger is merged with `{ correlationId }`.
 */
function withCorrelationId(correlationId) {
    return {
        info(event, payload) {
            info(event, Object.assign(Object.assign({}, (payload !== null && payload !== void 0 ? payload : {})), { correlationId }));
        },
        warn(event, payload) {
            warn(event, Object.assign(Object.assign({}, (payload !== null && payload !== void 0 ? payload : {})), { correlationId }));
        },
        error(event, errOrPayload, extraPayload) {
            error(event, errOrPayload, Object.assign(Object.assign({}, (extraPayload !== null && extraPayload !== void 0 ? extraPayload : {})), { correlationId }));
        },
    };
}
/**
 * Parse a dot-path with optional `[N]` array indexers into an ordered list of
 * segments. Each segment captures an object key, and optionally one or more
 * array indices that follow it.
 *
 * Example: "purchase_units[0].payments.captures[0].id" parses to
 *   [{key:'purchase_units', index:0}, {key:'payments'}, {key:'captures', index:0}, {key:'id'}]
 *
 * Note: a single segment may carry multiple indices (e.g. `foo[0][1]`); we
 * model that by emitting one segment per `[N]` after the first, with an empty
 * `key` to signal "stay on the array, descend by index".
 */
function parsePath(path) {
    const segments = [];
    const parts = path.split('.');
    for (const part of parts) {
        if (part.length === 0)
            continue;
        // Match `name`, `name[0]`, `name[0][1]`, `[0]`, etc.
        const match = part.match(/^([^[\]]*)((?:\[\d+\])*)$/);
        if (!match) {
            // Unparseable segment — skip the whole path defensively.
            return [];
        }
        const [, name, bracketed] = match;
        const indices = [];
        if (bracketed) {
            const re = /\[(\d+)\]/g;
            let m;
            while ((m = re.exec(bracketed)) !== null) {
                indices.push(Number(m[1]));
            }
        }
        if (name.length === 0 && indices.length === 0)
            continue;
        if (name.length > 0) {
            segments.push({ key: name, index: indices.length > 0 ? indices[0] : undefined });
            for (let i = 1; i < indices.length; i++) {
                segments.push({ key: '', index: indices[i] });
            }
        }
        else {
            // Pure index segment (rare in our domain, but handle for completeness).
            for (const idx of indices)
                segments.push({ key: '', index: idx });
        }
    }
    return segments;
}
/** Resolve a parsed path against `value`, returning `undefined` if any hop misses. */
function resolvePath(value, segments) {
    let current = value;
    for (const seg of segments) {
        if (current === null || current === undefined)
            return undefined;
        if (seg.key.length > 0) {
            if (!isPlainObject(current))
                return undefined;
            current = current[seg.key];
        }
        if (seg.index !== undefined) {
            if (!Array.isArray(current))
                return undefined;
            current = current[seg.index];
        }
    }
    return current;
}
/**
 * Set `leaf` at the path described by `segments` inside `target`, lazily
 * materializing intermediate objects/arrays so the output mirrors the input
 * shape. Existing values at intermediate hops are preserved (so multiple
 * allow-list paths can share parents).
 */
function setAtPath(target, segments, leaf) {
    if (segments.length === 0)
        return;
    // Walk all but the last segment, materializing containers as we go.
    let cursor = target;
    for (let i = 0; i < segments.length - 1; i++) {
        const seg = segments[i];
        cursor = descendOrCreate(cursor, seg, /*nextNeedsArray*/ false, segments[i + 1]);
    }
    // Place the leaf at the final segment.
    const last = segments[segments.length - 1];
    placeLeaf(cursor, last, leaf);
}
function descendOrCreate(cursor, seg, _nextNeedsArray, next) {
    // Step 1: descend by key (if present), creating an object/array placeholder if missing.
    let here;
    if (seg.key.length > 0) {
        const obj = cursor;
        if (obj[seg.key] === undefined) {
            // Create an array if this segment also has an index, otherwise an object —
            // unless the very next descent expects an object key, which is handled below.
            obj[seg.key] = seg.index !== undefined ? [] : {};
        }
        here = obj[seg.key];
    }
    else {
        here = cursor;
    }
    // Step 2: descend by index (if present), creating a child container if missing.
    if (seg.index !== undefined) {
        if (!Array.isArray(here)) {
            // Shape mismatch with a previously-set scalar: replace with array.
            const arr = [];
            if (seg.key.length > 0) {
                cursor[seg.key] = arr;
            }
            here = arr;
        }
        const arr = here;
        if (arr[seg.index] === undefined) {
            // Decide what kind of container the next hop needs.
            arr[seg.index] = next.index !== undefined && next.key.length === 0 ? [] : {};
        }
        here = arr[seg.index];
    }
    if (Array.isArray(here) || isPlainObject(here)) {
        return here;
    }
    // A scalar was previously placed here — overwrite with an object so descent
    // can continue. Only happens with overlapping/redundant allow-list entries.
    const replacement = {};
    if (seg.index !== undefined && seg.key.length > 0) {
        const arr = cursor[seg.key];
        arr[seg.index] = replacement;
    }
    else if (seg.key.length > 0) {
        cursor[seg.key] = replacement;
    }
    return replacement;
}
function placeLeaf(cursor, seg, leaf) {
    if (seg.key.length > 0 && seg.index === undefined) {
        cursor[seg.key] = leaf;
        return;
    }
    if (seg.key.length > 0 && seg.index !== undefined) {
        const obj = cursor;
        if (!Array.isArray(obj[seg.key]))
            obj[seg.key] = [];
        const arr = obj[seg.key];
        arr[seg.index] = leaf;
        return;
    }
    if (seg.key.length === 0 && seg.index !== undefined) {
        if (Array.isArray(cursor)) {
            cursor[seg.index] = leaf;
        }
        return;
    }
}
/**
 * [S8] Project an arbitrary value down to an allow-listed shape. Only the
 * fields named in `allowList` survive; everything else is dropped. The output
 * mirrors the structural shape of the input along the allow-listed paths.
 *
 * Paths support dot navigation and `[N]` array indexing, e.g.
 *   `purchase_units[0].payments.captures[0].id`.
 *
 * Paths whose value is `undefined` are skipped (the key does not appear in
 * the output).
 */
function project(value, allowList) {
    const out = {};
    for (const path of allowList) {
        const segments = parsePath(path);
        if (segments.length === 0)
            continue;
        const resolved = resolvePath(value, segments);
        if (resolved === undefined)
            continue;
        setAtPath(out, segments, resolved);
    }
    return out;
}
//# sourceMappingURL=logger.js.map