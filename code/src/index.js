#!/usr/bin/env node
/**
 * index.js  –  RAG Support Triage Agent CLI
 *
 * Commands:
 *   triage      Process all tickets in support_tickets.csv (default)
 *   interactive  Ask a one-off question in the terminal (REPL mode)
 *
 * Usage:
 *   node src/index.js triage [--tickets <csv>] [--data <dir>] [--out <dir>] [--top-k <n>]
 *   node src/index.js interactive
 */

import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";
import { program } from "commander";
import chalk from "chalk";
import ora from "ora";

import { parseCSV, loadCorpus } from "./loader.js";
import { buildRetriever } from "./retriever.js";
import { resolveCompany } from "./inferCompany.js";
import { checkEscalation, escalationJustification } from "./escalation.js";
import { triageTicket } from "./agent.js";
import { writeJSON, writeCSV, formatResultForTerminal } from "./output.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Helpers ───────────────────────────────────────────────────────────────────

function printBanner() {
  console.log(
    chalk.bold.cyan(`
╔══════════════════════════════════════════════════╗
║       RAG Support Triage Agent  v1.0.0           ║
║   HackerRank · Claude · Visa  —  by Bilal        ║
╚══════════════════════════════════════════════════╝
`)
  );
}

function printTicketHeader(index, total, ticket, company) {
  console.log(
    chalk.bold(`\n[${index + 1}/${total}] `) +
    chalk.blue(`Company: ${chalk.bold(company.toUpperCase())}`) +
    "  " +
    chalk.dim(`Subject: ${ticket.Subject || "(none)"}`)
  );
  console.log(chalk.dim("  Issue: ") + ticket.Issue.slice(0, 120).replace(/\n/g, " ") + (ticket.Issue.length > 120 ? "…" : ""));
}

function printResult(result) {
  const fields = formatResultForTerminal(result);
  for (const { label, value, color } of fields) {
    const colorFn = chalk[color] ?? chalk.white;
    console.log(`  ${chalk.bold(label.padEnd(14))} ${colorFn(value)}`);
  }
}

// ── Triage command ────────────────────────────────────────────────────────────

async function runTriage(options) {
  printBanner();

  const ticketsPath = options.tickets ?? path.join(ROOT, "support_tickets", "support_tickets.csv");
  const dataDir     = options.data    ?? path.join(ROOT, "data");
  const outDir      = options.out     ?? path.join(ROOT, "output");
  const topK        = parseInt(options.topK ?? "5", 10);

  // 1. Load corpus
  const corpusSpinner = ora(chalk.dim("Loading knowledge-base corpus…")).start();
  const corpus = loadCorpus(dataDir);
  corpusSpinner.succeed(chalk.green(`Loaded ${corpus.length} corpus documents`));

  if (corpus.length === 0) {
    console.log(chalk.yellow("  ⚠  No corpus documents found. Make sure the data/ directory exists and contains .md files."));
  }

  // 2. Build retriever
  const { retrieve } = buildRetriever(corpus);

  // 3. Load tickets
  const ticketSpinner = ora(chalk.dim("Reading support tickets…")).start();
  let tickets;
  try {
    tickets = await parseCSV(ticketsPath);
    ticketSpinner.succeed(chalk.green(`Loaded ${tickets.length} tickets from ${path.basename(ticketsPath)}`));
  } catch (err) {
    ticketSpinner.fail(chalk.red(`Failed to read tickets CSV: ${err.message}`));
    process.exit(1);
  }

  // 4. Process each ticket
  const allResults = [];
  console.log(chalk.bold.white("\n──────────────────────── TRIAGE ────────────────────────\n"));

  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];

    // Resolve company (handle None / missing)
    const company = resolveCompany(ticket.Company, [ticket.Issue, ticket.Subject].join(" "));
    const enrichedTicket = { ...ticket, Company: company };

    printTicketHeader(i, tickets.length, ticket, company);

    // Check for automatic escalation (no LLM call needed)
    const { escalate, reason } = checkEscalation(enrichedTicket);

    let result;

    if (escalate) {
      const spinner = ora(chalk.dim("  Escalating (high-risk pattern detected)…")).start();
      result = {
        status:        "escalated",
        product_area:  reason ?? "security",
        response:      "This issue has been flagged and escalated to our specialist team. A human agent will contact you shortly.",
        justification: escalationJustification(reason),
        request_type:  reason?.includes("billing") ? "billing" : reason?.includes("fraud") ? "security" : "account_access",
      };
      spinner.warn(chalk.red(`  ⚠  ESCALATED — ${reason}`));
    } else {
      // Retrieve relevant snippets
      const snippets = retrieve(enrichedTicket, topK);
      const snippetCount = snippets.length;

      const spinner = ora(chalk.dim(`  Retrieving ${snippetCount} snippets → sending to LLM…`)).start();
      try {
        result = await triageTicket(enrichedTicket, snippets);
        spinner.succeed(chalk.green(`  ✓  ${result.status.toUpperCase()}`));
      } catch (err) {
        spinner.fail(chalk.red(`  ✗  LLM error: ${err.message}`));
        result = {
          status:        "escalated",
          product_area:  "unknown",
          response:      "An error occurred while processing this ticket. Please handle manually.",
          justification: `API error: ${err.message}`,
          request_type:  "technical",
        };
      }
    }

    printResult(result);

    allResults.push({
      ticket_index: i + 1,
      company,
      subject:       ticket.Subject ?? "",
      issue:         ticket.Issue   ?? "",
      ...result,
    });
  }

  // 5. Write output
  console.log(chalk.bold.white("\n──────────────────────── OUTPUT ────────────────────────\n"));
  const jsonOut = path.join(outDir, "triage_results.json");
  const csvOut  = path.join(outDir, "triage_results.csv");
  writeJSON(allResults, jsonOut);
  writeCSV(allResults,  csvOut);

  console.log(chalk.green(`  ✓ JSON → ${jsonOut}`));
  console.log(chalk.green(`  ✓ CSV  → ${csvOut}`));

  // 6. Summary
  const replied   = allResults.filter((r) => r.status === "replied").length;
  const escalated = allResults.filter((r) => r.status === "escalated").length;
  console.log(
    chalk.bold(`\n  Summary: `) +
    chalk.green(`${replied} replied`) + "  " +
    chalk.red(`${escalated} escalated`) + "  " +
    chalk.dim(`(${allResults.length} total)\n`)
  );
}

// ── Interactive command ───────────────────────────────────────────────────────

async function runInteractive(options) {
  printBanner();
  console.log(chalk.cyan("  Interactive mode — type your support question. Type 'exit' to quit.\n"));

  const dataDir = options.data ?? path.join(ROOT, "data");
  const topK    = parseInt(options.topK ?? "5", 10);

  const corpusSpinner = ora(chalk.dim("Loading corpus…")).start();
  const corpus = loadCorpus(dataDir);
  corpusSpinner.succeed(chalk.green(`Loaded ${corpus.length} documents`));

  const { retrieve } = buildRetriever(corpus);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = (prompt) => new Promise((res) => rl.question(prompt, res));

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const issue   = await ask(chalk.bold.cyan("\n  Issue   : "));
    if (issue.trim().toLowerCase() === "exit") break;
    const subject = await ask(chalk.bold.cyan("  Subject : "));
    const company = await ask(chalk.bold.cyan("  Company (Claude/HackerRank/Visa/None): "));

    const ticket = { Issue: issue, Subject: subject, Company: company };
    const resolved = resolveCompany(company, [issue, subject].join(" "));
    ticket.Company = resolved;

    const { escalate, reason } = checkEscalation(ticket);

    if (escalate) {
      console.log(chalk.red(`\n  ⚠  AUTO-ESCALATED: ${escalationJustification(reason)}`));
      continue;
    }

    const snippets = retrieve(ticket, topK);
    const spinner = ora(chalk.dim("  Thinking…")).start();
    try {
      const result = await triageTicket(ticket, snippets);
      spinner.stop();
      console.log("\n" + chalk.bold("  RESULT:"));
      printResult(result);
    } catch (err) {
      spinner.fail(chalk.red(`  Error: ${err.message}`));
    }
  }

  rl.close();
  console.log(chalk.dim("\n  Goodbye!\n"));
}

// ── Commander setup ───────────────────────────────────────────────────────────

program
  .name("triage-agent")
  .description("RAG-powered support triage agent for HackerRank, Claude, and Visa")
  .version("1.0.0");

program
  .command("triage")
  .description("Process all tickets in the CSV and write results")
  .option("-t, --tickets <path>",  "Path to support_tickets.csv",     path.join(ROOT, "support_tickets", "support_tickets.csv"))
  .option("-d, --data    <path>",  "Path to corpus data/ directory",   path.join(ROOT, "data"))
  .option("-o, --out     <path>",  "Output directory for results",      path.join(ROOT, "output"))
  .option("-k, --top-k   <num>",   "Number of snippets to retrieve",   "5")
  .action(runTriage);

program
  .command("interactive")
  .description("Ask one-off questions in interactive mode")
  .option("-d, --data  <path>",    "Path to corpus data/ directory",   path.join(ROOT, "data"))
  .option("-k, --top-k <num>",     "Number of snippets to retrieve",   "5")
  .action(runInteractive);

// Default: run triage if no sub-command given
if (process.argv.length <= 2) {
  process.argv.push("triage");
}

program.parse(process.argv);
