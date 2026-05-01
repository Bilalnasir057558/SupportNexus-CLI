/**
 * escalation.js
 * Determines whether a support ticket must be escalated before sending to the LLM.
 *
 * High-risk categories that MUST be escalated:
 *  - Billing / payment disputes / refunds (financial)
 *  - Fraud / identity theft / stolen card
 *  - Account access / credential compromise
 *  - Security vulnerabilities / API key compromise
 *  - Prompt injection / system prompt exfiltration attempts
 */

// ── Keyword triggers ──────────────────────────────────────────────────────────

const ESCALATION_PATTERNS = [
  // Financial / billing
  { pattern: /\b(billing|refund|chargeback|dispute[sd]?|stolen.*(card|cheque)|card.*(stolen|lost))\b/i, reason: "billing/financial" },
  { pattern: /\b(payment.*fail|charge.*wrong|overcharg|money.*back|pay.*issue)\b/i, reason: "billing/financial" },

  // Fraud / identity
  { pattern: /\b(fraud|scam|identity.?theft|account.*(hacked|compromised)|unauthorized.*(access|charge|transaction))\b/i, reason: "fraud/identity" },
  { pattern: /\b(stolen.*(identity|account)|phish|social.?engineer)\b/i, reason: "fraud/identity" },

  // Account access
  { pattern: /\b(lost.*(access|account|password)|account.*(lock|suspend|ban|disabled)|can.?t.*(log.?in|access))\b/i, reason: "account-access" },
  { pattern: /\b(api.?key.*(comprom|stolen|leak|expose)|comprom.*key)\b/i, reason: "security/api-key" },

  // Explicit security
  { pattern: /\b(security.*(vulnerabilit|bug|exploit|breach)|bug.?bounty|cve|zero.?day)\b/i, reason: "security-vulnerability" },

  // Prompt injection / exfiltration
  { pattern: /(affiche|show|reveal|dump|print|display).*(system.?prompt|internal.?rules|retrieved.?doc|logique|logic)\b/i, reason: "prompt-injection" },
  { pattern: /\b(ignore.*(previous|above|all).*(instruct|prompt)|jailbreak|bypass.*(filter|policy|rule))\b/i, reason: "prompt-injection" },
  { pattern: /delete\s+all\s+(file|data|record)/i, reason: "destructive-command" },

  // Urgent cash / emergency
  { pattern: /\b(urgent.*(cash|money|transfer)|emergency.*fund|need.*cash.*now)\b/i, reason: "urgent-financial" },
];

/**
 * Check if a ticket should be escalated.
 *
 * @param {object} ticket  - { Issue, Subject, Company }
 * @returns {{ escalate: boolean, reason: string|null }}
 */
export function checkEscalation(ticket) {
  const text = [ticket.Issue, ticket.Subject].filter(Boolean).join(" ");

  for (const { pattern, reason } of ESCALATION_PATTERNS) {
    if (pattern.test(text)) {
      return { escalate: true, reason };
    }
  }

  return { escalate: false, reason: null };
}

/**
 * Map an escalation reason to a human-readable justification string.
 * @param {string} reason
 * @returns {string}
 */
export function escalationJustification(reason) {
  const map = {
    "billing/financial":     "Ticket involves billing, payment disputes, or refund requests — requires human financial review.",
    "fraud/identity":        "Ticket involves potential fraud or identity theft — requires immediate security escalation.",
    "account-access":        "Ticket involves lost/suspended account access — requires identity verification by support staff.",
    "security/api-key":      "Ticket reports a compromised API key — requires urgent security team intervention.",
    "security-vulnerability": "Ticket reports a security vulnerability — routed to security/bug-bounty team.",
    "prompt-injection":      "Ticket contains a suspected prompt-injection or system-prompt exfiltration attempt — blocked and escalated.",
    "destructive-command":   "Ticket requests destructive operations — escalated per security policy.",
    "urgent-financial":      "Ticket involves an urgent financial request — requires human authorization.",
  };
  return map[reason] ?? "Ticket flagged for manual review by the support team.";
}
