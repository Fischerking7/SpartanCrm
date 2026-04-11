import { db } from "./db";
import { systemSettings } from "@shared/schema";

const SYSTEM_SETTINGS_DEFAULTS = [
  { key: "auto_approval_enabled", value: "true" },
  { key: "auto_approval_confidence_threshold", value: "80" },
  { key: "auto_approval_max_amount_cents", value: "50000" },
  { key: "auto_approval_new_rep_days", value: "90" },
  { key: "auto_match_confident_threshold", value: "75" },
  { key: "auto_match_ambiguous_threshold", value: "40" },
  { key: "auto_post_match_threshold", value: "90" },
  { key: "connect_rate_target", value: "70" },
  // Payment variance alert thresholds (configurable by ADMIN via system settings)
  { key: "variance_threshold_pct", value: "5" },
  { key: "variance_threshold_cents", value: "1000" },
  // Compliance warning thresholds (days before expiry)
  { key: "compliance_warn_days_critical", value: "30", description: "Days before expiry to show critical (red) warning" },
  { key: "compliance_warn_days_warning", value: "60", description: "Days before expiry to show warning (amber)" },
  { key: "compliance_warn_days_notice", value: "90", description: "Days before expiry to show notice (blue)" },
  // Dispute auto-escalation thresholds
  { key: "dispute_escalation_amount_threshold", value: "500", description: "Auto-escalate disputes above this dollar amount" },
  { key: "dispute_escalation_age_pending_days", value: "14", description: "Auto-escalate PENDING disputes older than this many days" },
  { key: "dispute_escalation_age_review_days", value: "7", description: "Auto-escalate UNDER_REVIEW disputes older than this many days" },
];

export async function seedSystemSettings() {
  for (const setting of SYSTEM_SETTINGS_DEFAULTS) {
    await db.insert(systemSettings).values(setting).onConflictDoNothing();
  }
  console.log("[Seed] system_settings defaults applied");
}
