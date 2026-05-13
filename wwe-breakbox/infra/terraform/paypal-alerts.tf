################################################################################
# PayPal integration — Cloud Monitoring alert policies (Terraform).
#
# Per change-log entry S12 in /Users/plummerman/.claude/plans/paypal-integration-plan.md,
# every alert policy that pages on-call for the PayPal flow MUST be managed in
# this file. Console-only edits are forbidden so any silent disablement shows
# up as a `git diff` against this file.
#
# Apply (manual, only at production cutover or threshold recalibration):
#
#   cd infra/terraform
#   terraform init
#   terraform plan  -var-file=prod.tfvars
#   terraform apply -var-file=prod.tfvars
#
# Resources defined below:
#
#   Log-based metrics (logging.googleapis.com/user/...):
#     - paypal_refund_alert_required           (C12)
#     - paypal_refund_circuit_breaker_tripped  (C22)
#     - paypal_amount_mismatch                 (S9)
#     - paypal_webhook_verifier_failure        (S3 — definitive forgery)
#     - paypal_webhook_verifier_call_error     (S3 — transient verifier outage)
#     - paypal_order_created                   (S19 — abuse signal)
#
#   Alert policies (one per metric):
#     - refund_alert_required        CRITICAL
#     - refund_circuit_breaker       CRITICAL
#     - amount_mismatch              CRITICAL
#     - webhook_verifier_failure     CRITICAL
#     - webhook_verifier_call_error  WARNING
#     - order_creation_abuse_rate    WARNING
#
# Event names below are pinned to the structured-log event names actually
# emitted by the source as of this commit. If you rename a logger event in
# `functions/src/paypal/*.ts`, you MUST update the corresponding `filter`
# attribute here in the same PR — otherwise the alert will silently go dark.
################################################################################

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0, < 7.0"
    }
  }
}

provider "google" {
  project = var.project_id
}

locals {
  # WARNING policies fall back to the main channel list if no quieter channel
  # set is provided. Keeps the wiring simple in single-channel projects.
  warning_channels = length(var.warning_notification_channel_ids) > 0 ? var.warning_notification_channel_ids : var.notification_channel_ids

  # Shared documentation prefix.
  runbook_link = "See `docs/payments-runbook.md` and the PayPal integration plan (change-log)."
}

################################################################################
# Log-based metrics
#
# Each metric counts log entries whose `jsonPayload.event` equals the structured
# event name emitted by the corresponding logger.* call in functions/src/paypal.
#
# We intentionally use DELTA / INT64 with a "1" unit — this is the canonical
# shape for a log-counter metric and aligns cleanly with `ALIGN_DELTA` in the
# alert condition aggregations.
################################################################################

resource "google_logging_metric" "paypal_refund_alert_required" {
  name        = "paypal_refund_alert_required"
  description = "Counts permanent PayPal refund failures that wrote `pendingRefunds/{captureId}.status = 'alert_required'`. Source: refund.ts -> log.error('paypal.refund.permanent_failure')."
  filter      = "resource.type=\"cloud_function\" AND jsonPayload.event=\"paypal.refund.permanent_failure\""

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_logging_metric" "paypal_refund_circuit_breaker_tripped" {
  name        = "paypal_refund_circuit_breaker_tripped"
  description = "Counts circuit-breaker trips in the pendingRefunds retry scheduler. Source: pendingRefundsRetry.ts -> logger.error('pendingRefunds_circuit_breaker_tripped')."
  filter      = "resource.type=\"cloud_function\" AND jsonPayload.event=\"pendingRefunds_circuit_breaker_tripped\""

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_logging_metric" "paypal_amount_mismatch" {
  name        = "paypal_amount_mismatch"
  description = "Counts PayPal capture responses where `purchase_units[0].amount` did not match our stored expectedAmount. Source: captureOrder.ts -> log.error('paypal_amount_mismatch')."
  filter      = "resource.type=\"cloud_function\" AND jsonPayload.event=\"paypal_amount_mismatch\""

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_logging_metric" "paypal_webhook_verifier_failure" {
  name        = "paypal_webhook_verifier_failure_response_count"
  description = "Counts PayPal webhook payloads where the verifier returned a non-SUCCESS verification_status (definitive forgery signal). Source: verifySignature.ts -> logger.error('paypal_webhook_verifier_failure_response_count')."
  filter      = "resource.type=\"cloud_function\" AND jsonPayload.event=\"paypal_webhook_verifier_failure_response_count\""

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_logging_metric" "paypal_webhook_verifier_call_error" {
  name        = "paypal_webhook_verifier_call_error"
  description = "Counts transient verifier-call failures (network, 5xx, 429) where the verifier was unreachable but the webhook itself may be legitimate. Source: verifySignature.ts -> logger.error('paypal_webhook_verifier_call_error')."
  filter      = "resource.type=\"cloud_function\" AND jsonPayload.event=\"paypal_webhook_verifier_call_error\""

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_logging_metric" "paypal_order_created" {
  name        = "paypal_order_created"
  description = "Counts successful PayPal order creations. Source: createOrder.ts -> log.info('paypal.createOrder.created'). Used for the S19 abuse-rate alert."
  filter      = "resource.type=\"cloud_function\" AND jsonPayload.event=\"paypal.createOrder.created\""

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

################################################################################
# Alert policies
#
# All policies use:
#   - combiner = "OR" (single-condition policies; combiner is moot but required)
#   - duration = "0s" (fire as soon as the threshold is crossed in any window)
#   - aggregations.per_series_aligner = "ALIGN_DELTA" (sum-of-counts per window)
#   - documentation.mime_type = "text/markdown"
#   - alert_strategy.auto_close = var.alert_auto_close_duration
#
# The `filter` attribute in each condition references the log-based metric by
# its full `logging.googleapis.com/user/<name>` resource name — matching the
# metric `name` attributes above. We add a `depends_on` to make the ordering
# explicit (Terraform's implicit dep on the metric name string is not enough
# because we use a string literal, not a `.name` reference).
################################################################################

# ---------------------------------------------------------------------------
# C12 — Refund failures requiring on-call alert
# ---------------------------------------------------------------------------
resource "google_monitoring_alert_policy" "refund_alert_required" {
  display_name = "PayPal: Refund requires manual intervention (alert_required)"
  combiner     = "OR"
  severity     = "CRITICAL"

  conditions {
    display_name = "pendingRefunds.status='alert_required' count > 0 / 1m"

    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.paypal_refund_alert_required.name}\" AND resource.type=\"cloud_function\""
      duration        = "0s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_DELTA"
      }
    }
  }

  notification_channels = var.notification_channel_ids

  alert_strategy {
    auto_close = var.alert_auto_close_duration
  }

  documentation {
    mime_type = "text/markdown"
    content   = <<-EOT
      **Severity:** CRITICAL — page on-call.

      A PayPal refund failed permanently. The `pendingRefunds/{captureId}` doc
      has been written with `status = 'alert_required'` and will NOT be
      retried automatically. Money owed to a buyer is currently not refunded.

      **Action:**
      1. Open Firestore -> `pendingRefunds` and find the affected captureId.
      2. Inspect `errorCode` / `errorMessage` for the PayPal failure reason.
      3. Resolve manually via PayPal dashboard if needed; then mark the doc
         `status = 'resolved_manually'` so it stops alerting.

      Source event: `paypal.refund.permanent_failure` (refund.ts handleFailure).

      ${local.runbook_link}
    EOT
  }
}

# ---------------------------------------------------------------------------
# C22 — Refund queue halted (circuit breaker tripped)
# ---------------------------------------------------------------------------
resource "google_monitoring_alert_policy" "refund_circuit_breaker" {
  display_name = "PayPal: Refund retry queue circuit breaker tripped"
  combiner     = "OR"
  severity     = "CRITICAL"

  conditions {
    display_name = "circuit_breaker_tripped count > 0 / 5m"

    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.paypal_refund_circuit_breaker_tripped.name}\" AND resource.type=\"cloud_function\""
      duration        = "0s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_DELTA"
      }
    }
  }

  notification_channels = var.notification_channel_ids

  alert_strategy {
    auto_close = var.alert_auto_close_duration
  }

  documentation {
    mime_type = "text/markdown"
    content   = <<-EOT
      **Severity:** CRITICAL — page on-call.

      The pendingRefunds retry scheduler tripped its circuit breaker — too
      many consecutive refund attempts failed, so the entire retry loop is
      now halted. New `pendingRefunds` docs are still being written, but
      none of them will be retried until the breaker is reset.

      **Action:**
      1. Check PayPal API status (status.paypal.com) and our recent error
         logs for the dominant failure mode.
      2. If PayPal is healthy, inspect recent refund attempts for a poisoned
         doc that may be jamming the queue.
      3. Reset the breaker per the runbook once root cause is addressed.

      Source event: `pendingRefunds_circuit_breaker_tripped` (pendingRefundsRetry.ts).

      ${local.runbook_link}
    EOT
  }
}

# ---------------------------------------------------------------------------
# S9 — Amount mismatch (fraud / bug signal)
# ---------------------------------------------------------------------------
resource "google_monitoring_alert_policy" "amount_mismatch" {
  display_name = "PayPal: Capture amount mismatch detected"
  combiner     = "OR"
  severity     = "CRITICAL"

  conditions {
    display_name = "amount_mismatch count > 0 / 5m"

    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.paypal_amount_mismatch.name}\" AND resource.type=\"cloud_function\""
      duration        = "0s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_DELTA"
      }
    }
  }

  notification_channels = var.notification_channel_ids

  alert_strategy {
    auto_close = var.alert_auto_close_duration
  }

  documentation {
    mime_type = "text/markdown"
    content   = <<-EOT
      **Severity:** CRITICAL — page on-call. Treat as a fraud signal until
      proven otherwise.

      A PayPal capture returned an `amount.value` that does not match the
      `expectedAmount` we stored at order-creation time. The capture has
      been auto-refunded by `captureOrder.ts`, but a mismatch implies either
      client-side tampering or a server-side calculation bug.

      **Action:**
      1. Pull the `correlationId` from the alert and trace through the
         createOrder + captureOrder logs.
      2. Diff `expectedAmount` (Firestore `paypalOrders/{id}`) vs the actual
         capture amount in the log.
      3. If client-side tampering, escalate per security runbook.

      Source event: `paypal_amount_mismatch` (captureOrder.ts).

      ${local.runbook_link}
    EOT
  }
}

# ---------------------------------------------------------------------------
# S3 — Webhook verifier returned FAILURE (forgery attempt)
# ---------------------------------------------------------------------------
resource "google_monitoring_alert_policy" "webhook_verifier_failure" {
  display_name = "PayPal: Webhook signature verification FAILURE"
  combiner     = "OR"
  severity     = "CRITICAL"

  conditions {
    display_name = "verifier_failure_response_count > 0 / 5m"

    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.paypal_webhook_verifier_failure.name}\" AND resource.type=\"cloud_function\""
      duration        = "0s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_DELTA"
      }
    }
  }

  notification_channels = var.notification_channel_ids

  alert_strategy {
    auto_close = var.alert_auto_close_duration
  }

  documentation {
    mime_type = "text/markdown"
    content   = <<-EOT
      **Severity:** CRITICAL — page on-call. Treat as a forgery attempt
      until proven otherwise.

      PayPal's verifier endpoint returned a non-`SUCCESS` `verification_status`
      for an inbound webhook. We have rejected the event with HTTP 401, so
      no Firestore write occurred — but the source of the request is suspect.

      **Action:**
      1. Capture the `transmissionId` and `correlationId` from the alert.
      2. Inspect Cloud Run / function logs for the source IP and User-Agent.
      3. If volume is non-trivial, consider tightening WAF rules at the
         load balancer layer.

      Source event: `paypal_webhook_verifier_failure_response_count` (verifySignature.ts).

      ${local.runbook_link}
    EOT
  }
}

# ---------------------------------------------------------------------------
# S3 — Verifier-call failure rate (transient signal — WARNING)
# ---------------------------------------------------------------------------
resource "google_monitoring_alert_policy" "webhook_verifier_call_error" {
  display_name = "PayPal: Webhook verifier call-error rate elevated"
  combiner     = "OR"
  severity     = "WARNING"

  conditions {
    display_name = "verifier_call_error rate > ${var.verifier_call_error_rate_threshold}/min"

    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.paypal_webhook_verifier_call_error.name}\" AND resource.type=\"cloud_function\""
      duration        = "0s"
      comparison      = "COMPARISON_GT"
      threshold_value = var.verifier_call_error_rate_threshold

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_DELTA"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = local.warning_channels

  alert_strategy {
    auto_close = var.alert_auto_close_duration
  }

  documentation {
    mime_type = "text/markdown"
    content   = <<-EOT
      **Severity:** WARNING — investigate but do not page unless sustained.

      The PayPal verifier endpoint (`/v1/notifications/verify-webhook-signature`)
      is failing more than `${var.verifier_call_error_rate_threshold}` times
      per 5-minute window. Affected webhooks are returned 503 so PayPal will
      retry — but if this persists, downstream events (capture confirmations,
      refund completions) will be delayed.

      **Action:**
      1. Check status.paypal.com for an active incident.
      2. Inspect the alert's sample log entries for the dominant failure mode
         (timeout vs 5xx vs 401 — a 401 implies a credential rotation issue).

      Source event: `paypal_webhook_verifier_call_error` (verifySignature.ts).

      ${local.runbook_link}
    EOT
  }
}

# ---------------------------------------------------------------------------
# S19 — Global order-creation rate (potential abuse / runaway bot)
# ---------------------------------------------------------------------------
resource "google_monitoring_alert_policy" "order_creation_abuse_rate" {
  display_name = "PayPal: Order creation rate exceeds abuse threshold"
  combiner     = "OR"
  severity     = "WARNING"

  conditions {
    display_name = "paypal_order_created rate > ${var.order_creation_rate_threshold}/min"

    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.paypal_order_created.name}\" AND resource.type=\"cloud_function\""
      duration        = "0s"
      comparison      = "COMPARISON_GT"
      threshold_value = var.order_creation_rate_threshold

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_DELTA"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = local.warning_channels

  alert_strategy {
    auto_close = var.alert_auto_close_duration
  }

  documentation {
    mime_type = "text/markdown"
    content   = <<-EOT
      **Severity:** WARNING — investigate; do not page on a single spike.

      Global PayPal order-creation rate exceeded
      `${var.order_creation_rate_threshold}` orders/minute. This is the S19
      abuse-rate signal. The default threshold is a deliberately conservative
      pre-launch placeholder — recalibrate via the
      `order_creation_rate_threshold` Terraform variable once we have a real
      baseline (per the integration plan's "calibrate post-launch" note).

      **Action:**
      1. Check the per-user rate limiter in `createOrder.ts` for hits.
      2. Inspect the top source IPs / userIds in the log sample.
      3. If clearly abuse, raise `paypal.maxOrdersPerUserPerMin` runtime
         config or deploy a temporary block.

      Source event: `paypal.createOrder.created` (createOrder.ts).

      ${local.runbook_link}
    EOT
  }
}
