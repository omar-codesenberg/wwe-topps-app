################################################################################
# Variables for the PayPal Cloud Monitoring alert-policy module.
#
# These are intentionally minimal — notification channels and the GCP project
# are passed in from a separate Terraform root module (or a `prod.tfvars` file
# kept in the secret store). See README.md for usage.
################################################################################

variable "project_id" {
  type        = string
  description = "GCP project ID (Firebase project) where the PayPal Cloud Functions and Firestore live."
}

variable "notification_channel_ids" {
  type        = list(string)
  description = <<-EOT
    Cloud Monitoring notification channel IDs to attach to every PayPal alert
    policy. Each entry must be a fully qualified resource name, e.g.
    `projects/<project>/notificationChannels/<id>`. Channels are expected to
    include at minimum a PagerDuty channel and an email channel; they are
    created out-of-band (or in a separate Terraform module) so this module
    stays focused on the alert policies themselves.
  EOT
}

variable "warning_notification_channel_ids" {
  type        = list(string)
  default     = []
  description = <<-EOT
    Optional override for WARNING-severity policies (verifier-call failures,
    abuse-rate signals). If empty, `notification_channel_ids` is used. Set
    this to route warnings to a quieter channel (e.g. Slack only, no
    PagerDuty page).
  EOT
}

variable "order_creation_rate_threshold" {
  type        = number
  default     = 30
  description = <<-EOT
    Per-minute order-creation rate that trips the S19 abuse alert. Default 30
    is a deliberately conservative pre-launch placeholder — the integration
    plan calls for post-launch calibration once we have a baseline.
  EOT
}

variable "verifier_call_error_rate_threshold" {
  type        = number
  default     = 5
  description = <<-EOT
    Per-minute count of `paypal_webhook_verifier_call_error` log entries that
    trips the S3 transient-failure WARNING. Heuristic — see plan §S3.
  EOT
}

variable "alert_auto_close_duration" {
  type        = string
  default     = "604800s" # 7 days
  description = "Cloud Monitoring auto-close duration for incidents (seconds suffix required by API)."
}
