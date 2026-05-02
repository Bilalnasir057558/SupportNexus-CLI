/**
 * escalation.js
 *
 * Pre-LLM escalation guard — catches tickets that must ALWAYS be escalated
 * before an LLM call is made. Uses explicit patterns so we don't rely on
 * the LLM for safety-critical routing.
 *
 * Key insight from sample_support_tickets.csv:
 *   - "site is down & none of the pages are accessible" → Escalated, bug
 *   - Refund requests → let LLM decide (corpus has refund info)
 *   - Score disputes → let LLM decide (out-of-scope reply)
 *
 * We only pre-escalate things that are DEFINITELY unsafe/unsupported
 * regardless of what the corpus says.
 */

// Patterns that should ALWAYS escalate before hitting the LLM
const HARD_ESCALATION_PATTERNS = [
  // Identity theft / fraud (active harm)
  { pattern: /\b(identity.?theft|my identity.*(stolen|compromised)|someone.*(stole|using).*(my|account))\b/i,         reason: "fraud/identity",        rt: "product_issue" },
  { pattern: /\b(fraud(?:ulent)?|unauthorized.*(charge|transaction|access)|account.*(hacked|taken.?over))\b/i,         reason: "fraud/identity",        rt: "product_issue" },

  // Compromised credentials / API keys
  { pattern: /\b(api.?key.*(comprom|stolen|leak|expos)|suspect.*key.*(stolen|leak))\b/i,                               reason: "security/api-key",      rt: "product_issue" },

  // Prompt injection / internal data exfiltration attempts
  { pattern: /(affiche|show|reveal|dump|display|print)\s+(all\s+)?(internal|system).*(rule|prompt|document|logic)/i,   reason: "prompt-injection",      rt: "invalid" },
  { pattern: /\b(ignore (all |previous |above )?(instruct|prompt)|jailbreak|bypass.*(filter|policy|rule|safety))\b/i, reason: "prompt-injection",      rt: "invalid" },

  // Destructive / malicious commands
  { pattern: /\bdelete\s+all\s+(file|data|record|system)\b/i,                                                          reason: "destructive-command",   rt: "invalid" },
  { pattern: /\b(rm\s+-rf|format\s+(c:|disk)|drop\s+table|truncate\s+database)\b/i,                                   reason: "destructive-command",   rt: "invalid" },

  // Major outage / site completely down (needs human ops)
  { pattern: /\b(site|platform|service|website|system)\s+(is\s+)?(completely\s+)?(down|not.?accessible|unreachable|offline)\b/i, reason: "outage",    rt: "bug" },
  { pattern: /\bnone of the pages are accessible\b/i,                                                                  reason: "outage",                rt: "bug" },

  // Stolen cards / cheques
  { pattern: /\b(stolen|lost).*(card|cheque|check)\b|\b(card|cheque|check).*(stolen|lost)\b/i,                        reason: "billing/financial",     rt: "billing" },
];

/**
 * Check if a ticket should be immediately escalated.
 * @param {{ Issue: string, Subject: string }} ticket
 * @returns {{ escalate: boolean, reason: string|null, rt: string }}
 */
export function checkEscalation(ticket) {
  const text = [ticket.Issue, ticket.Subject].filter(Boolean).join(" ");

  for (const { pattern, reason, rt } of HARD_ESCALATION_PATTERNS) {
    if (pattern.test(text)) {
      return { escalate: true, reason, rt };
    }
  }

  return { escalate: false, reason: null, rt: "product_issue" };
}

/**
 * Build an escalated result object directly (no LLM needed).
 * @param {string} reason
 * @param {string} rt - request_type
 * @returns {object}
 */
export function buildEscalationResult(reason, rt = "product_issue") {
  const messages = {
    "fraud/identity":       "Your case has been flagged as a potential fraud or identity issue. For your security, this has been escalated to our specialist team. A human agent will contact you shortly — please do not share any sensitive details via this channel.",
    "security/api-key":     "A potential API key compromise has been detected and escalated to our security team immediately. Please revoke your current key from the console right away and generate a new one.",
    "prompt-injection":     "This request could not be processed as it appears to contain an attempt to access internal system information. Your case has been flagged for review.",
    "destructive-command":  "This request involves a potentially destructive operation and cannot be processed automatically. It has been escalated for human review.",
    "outage":               "We have escalated your report of a service outage to our engineering team. We apologize for the inconvenience and are working to resolve this as quickly as possible.",
    "billing/financial":    "This issue involves billing, payments, or financial disputes and has been escalated to our financial team. A specialist will contact you shortly.",
  };

  const justifications = {
    "fraud/identity":       "Ticket contains fraud/identity theft indicators — mandatory escalation to security team, no automated response permitted.",
    "security/api-key":     "Ticket reports a compromised API key — escalated to security team for immediate key revocation and investigation.",
    "prompt-injection":     "Ticket contains a prompt injection or system-prompt exfiltration attempt — blocked and escalated per security policy.",
    "destructive-command":  "Ticket requests a destructive system operation — escalated per safety policy, not processed automatically.",
    "outage":               "Ticket reports a complete service outage affecting all users — escalated to engineering/ops team.",
    "billing/financial":    "Ticket involves billing, payment disputes, or refund requests — requires human financial review.",
  };

  return {
    status:        "escalated",
    product_area:  reason.replace("/", "_"),
    response:      messages[reason]     ?? "This issue has been escalated to our specialist team. A human agent will contact you shortly.",
    justification: justifications[reason] ?? "Ticket flagged for mandatory human review based on content analysis.",
    request_type:  rt,
  };
}