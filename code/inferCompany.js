/**
 * inferCompany.js
 * Infers the support company from ticket content when Company is "None" or missing.
 * Uses keyword heuristics as a fast pre-filter before hitting the LLM.
 */

// Simple keyword map: if any keyword appears in the text, vote for that company.
const KEYWORD_MAP = {
  claude: [
    "claude", "anthropic", "bedrock", "prompt", "api key", "console",
    "conversation", "claude.ai", "llm", "model", "workspace",
  ],
  hackerrank: [
    "hackerrank", "hacker rank", "assessment", "test", "coding challenge",
    "recruiter", "interview", "submission", "score", "certificate",
    "mock interview", "resume builder", "community", "hiring", "candidate",
  ],
  visa: [
    "visa", "card", "payment", "transaction", "merchant", "chargeback",
    "fraud", "dispute", "refund", "traveller", "cash advance", "atm",
    "billing", "stolen card", "lost card", "identity theft",
  ],
};

/**
 * Infer company from raw text using keyword voting.
 * Returns the company name with the most keyword hits, or "unknown" if tied/empty.
 *
 * @param {string} text - Combined issue + subject text
 * @returns {string}  "claude" | "hackerrank" | "visa" | "unknown"
 */
export function inferCompanyFromText(text) {
  if (!text) return "unknown";
  const lower = text.toLowerCase();

  const scores = {};
  for (const [company, keywords] of Object.entries(KEYWORD_MAP)) {
    scores[company] = keywords.filter((kw) => lower.includes(kw)).length;
  }

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topCompany, topScore] = best[0];

  // Require at least one hit; if all zero, return unknown
  return topScore > 0 ? topCompany : "unknown";
}

/**
 * Normalise the Company field from a ticket row.
 * Handles "None", empty strings, null, and whitespace.
 *
 * @param {string|undefined} raw
 * @param {string} issueText  - fallback text if company is absent
 * @returns {string}
 */
export function resolveCompany(raw, issueText = "") {
  const cleaned = (raw ?? "").trim().toLowerCase();
  if (!cleaned || cleaned === "none") {
    return inferCompanyFromText(issueText);
  }
  // Normalise to our canonical lowercase keys
  if (cleaned.includes("hackerrank")) return "hackerrank";
  if (cleaned.includes("claude") || cleaned.includes("anthropic")) return "claude";
  if (cleaned.includes("visa")) return "visa";
  return cleaned;
}
