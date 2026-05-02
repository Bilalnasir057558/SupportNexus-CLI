# SupportNexus-CLI Agent

This is the AI agent for triaging support tickets for HackerRank, Claude, and Visa.

## Files

- `index.js`: Maqin CLI entry point
- `loader.js`: Loads CSV tickets and corpus documents
- `retriever.js`: Fuzzy search over corpus using Fuse.js
- `inferCompany.js`: Infers company from ticket text
- `escalation.js`: Pre-LLM guardrails for high-risk tickets
- `agent.js`: Calls OpenRouter LLM for triage decisions
- `output.js`: Writes results to CSV and JSON

## Usage

```bash
npm install
node code/index.js triage
```

## Dependencies

- csv-parser: Parse CSV files
- fuse.js: Fuzzy search
- openai: OpenRouter API client
- chalk: Terminal colors
- ora: Spinners
- commander: CLI
- dotenv: Environment variables

## Environment

Set `OPENAI_API_KEY` to your OpenRouter API key.