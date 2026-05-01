# RAG Support Triage Agent

A terminal-based Retrieval-Augmented Generation (RAG) support triage agent built in Node.js.
Handles support tickets for **HackerRank**, **Claude (Anthropic)**, and **Visa**.

---

## Architecture

```
support_tickets.csv
        │
        ▼
  ┌─────────────┐     ┌──────────────────────────────────────────────┐
  │  loader.js  │────▶│  data/                                        │
  │  (csv-parser│     │   ├── claude/  (billing, api, troubleshooting)│
  │   + fs walk)│     │   ├── hackerrank/ (tests, scoring, hiring)    │
  └─────────────┘     │   └── visa/  (cards, fraud, travel)           │
        │              └──────────────────────────────────────────────┘
        │                              │
        ▼                              ▼
 ┌─────────────┐              ┌──────────────┐
 │inferCompany │              │ retriever.js  │
 │  .js        │              │ (Fuse.js      │
 │ (heuristic) │              │  fuzzy index) │
 └──────┬──────┘              └──────┬───────┘
        │                            │
        ▼                            ▼ top-k snippets
 ┌─────────────┐           ┌──────────────────┐
 │escalation.js│──escalate▶│    output.js      │
 │ (patterns)  │           │  (JSON + CSV)     │
 └──────┬──────┘           └──────────────────┘
        │ (safe tickets)            ▲
        ▼                           │
 ┌─────────────┐                    │
 │  agent.js   │────────────────────┘
 │ (Anthropic  │
 │  Claude API)│
 └─────────────┘
```

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Set your Anthropic API key
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

### 3. Ensure your data directory exists
```
data/
├── claude/
│   ├── claude-api-and-console/
│   │   ├── pricing-and-billing/
│   │   └── troubleshooting/
│   └── ...
├── hackerrank/
│   ├── engage/
│   └── ...
└── visa/
    └── support/
```

---

## Usage

### Process all tickets (default)
```bash
node src/index.js triage
# or:
npm start
```

### With custom paths
```bash
node src/index.js triage \
  --tickets ./support_tickets/support_tickets.csv \
  --data    ./data \
  --out     ./output \
  --top-k   5
```

### Interactive REPL mode
```bash
node src/index.js interactive
```

---

## Output Schema

Every ticket produces a JSON row saved to `output/triage_results.json` and `output/triage_results.csv`:

| Field           | Values                                                        |
|----------------|---------------------------------------------------------------|
| `ticket_index`  | Row number in the CSV                                         |
| `company`       | Resolved company (claude / hackerrank / visa / unknown)       |
| `subject`       | Ticket subject                                                |
| `status`        | `replied` or `escalated`                                      |
| `product_area`  | e.g. `billing`, `api_usage`, `account_access`, `card_services`|
| `request_type`  | `billing`, `technical`, `account_access`, `product_issue`, `general`, `invalid`, `security`, `data_privacy` |
| `response`      | Draft customer-facing reply or escalation message             |
| `justification` | Internal note explaining the decision                         |

---

## Rules enforced

| Rule | How |
|------|-----|
| Corpus-only answers | System prompt forbids outside knowledge; LLM told to say "I don't have enough info" otherwise |
| High-risk escalation | `escalation.js` pattern-matches billing, fraud, account access, security vulns **before** the LLM is called |
| Company inference | `inferCompany.js` uses keyword voting when `Company = None` |
| Prompt injection protection | Escalation patterns catch attempts to extract internal logic |
| Destructive commands | Regex catches "delete all files"-style requests |

---

## Module overview

| File | Responsibility |
|------|---------------|
| `src/index.js` | CLI entry point (commander), `triage` + `interactive` commands |
| `src/loader.js` | CSV parsing (`csv-parser`) + corpus file walking |
| `src/retriever.js` | Fuse.js fuzzy index + company-filtered `retrieve()` |
| `src/inferCompany.js` | Keyword heuristic to infer company from ticket text |
| `src/escalation.js` | Pattern-based high-risk detection (no LLM needed) |
| `src/agent.js` | Anthropic API call with RAG context; returns structured JSON |
| `src/output.js` | JSON + CSV writer; terminal formatter |
