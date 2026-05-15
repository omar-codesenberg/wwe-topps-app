# PayPal Cloud Monitoring alert policies

Terraform module managing the Cloud Monitoring alert policies (and the
underlying log-based metrics) for the PayPal integration.

Per change-log entry **S12** in
`/Users/plummerman/.claude/plans/paypal-integration-plan.md`, every alert
policy that pages on-call for the PayPal flow is committed to this repo so
that any silent disablement shows up as a `git diff` against this directory.
**Console-only edits are forbidden.** If you tweak a threshold from the
console, mirror the change here in the same change-window.

## What it manages

Six log-based metrics + six alert policies:

| Plan ref | Display name | Severity | Window |
| --- | --- | --- | --- |
| C12 | Refund requires manual intervention | CRITICAL | > 0 / 1m |
| C22 | Refund retry queue circuit breaker tripped | CRITICAL | > 0 / 5m |
| S9  | Capture amount mismatch | CRITICAL | > 0 / 5m |
| S3  | Webhook signature verification FAILURE | CRITICAL | > 0 / 5m |
| S3  | Webhook verifier call-error rate elevated | WARNING | > N / 5m |
| S19 | Order creation rate exceeds abuse threshold | WARNING | > N / 1m |

Notification channels are NOT created here — they are passed in as a
variable (`notification_channel_ids`) so this module stays focused on the
policies. See "Notification channels" below.

## Apply

This module is **not applied automatically by CI**. The user runs it by
hand at production cutover or when recalibrating thresholds.

```bash
cd infra/terraform
terraform init
terraform plan  -var-file=prod.tfvars
terraform apply -var-file=prod.tfvars
```

`prod.tfvars` is **NOT in this repo** — it lives in the secret store.
Example shape:

```hcl
project_id = "wwe-breakbox-prod"

notification_channel_ids = [
  "projects/wwe-breakbox-prod/notificationChannels/<pagerduty-channel-id>",
  "projects/wwe-breakbox-prod/notificationChannels/<email-channel-id>",
]

# Optional — quieter routing for WARNING-severity policies.
warning_notification_channel_ids = [
  "projects/wwe-breakbox-prod/notificationChannels/<slack-channel-id>",
]

# Optional — calibrate post-launch per S19.
order_creation_rate_threshold      = 30
verifier_call_error_rate_threshold = 5
```

## Notification channels

Channels are managed out-of-band (a separate Terraform root module, or
manually in the console — they're rarely touched, and PagerDuty service
tokens have their own provisioning lifecycle). To list existing channels:

```bash
gcloud alpha monitoring channels list --project=wwe-breakbox-prod
```

Copy the `name` field of each channel you want to wire up into
`notification_channel_ids` in your tfvars.

## Editing event names

The `filter` attribute on each `google_logging_metric` matches the
structured-log event name emitted by the corresponding
`logger.error(...)` / `logger.info(...)` call in `functions/src/paypal/`.
**If you rename a logger event, you MUST update the matching `filter`
here in the same PR** — otherwise the alert silently goes dark.

Pinned event-name -> source map (as of last update):

| Filter event | Emitted by |
| --- | --- |
| `paypal.refund.permanent_failure` | `functions/src/paypal/refund.ts` |
| `pendingRefunds_circuit_breaker_tripped` | `functions/src/paypal/pendingRefundsRetry.ts` |
| `paypal_amount_mismatch` | `functions/src/paypal/captureOrder.ts` |
| `paypal_webhook_verifier_failure_response_count` | `functions/src/paypal/verifySignature.ts` |
| `paypal_webhook_verifier_call_error` | `functions/src/paypal/verifySignature.ts` |
| `paypal.createOrder.created` | `functions/src/paypal/createOrder.ts` |

## State

State is **not** stored locally. Configure a remote backend (GCS bucket)
in your tfvars wrapper before running `terraform init` against
production. Leaving state on a developer laptop will break future
applies.

## See also

- `/Users/plummerman/.claude/plans/paypal-integration-plan.md` — change log
  entries C12, C22, S3, S9, S12, S19.
- `docs/payments-runbook.md` — production cutover sequence and on-call
  triage steps referenced from the alert documentation bodies.
