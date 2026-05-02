#!/usr/bin/env node
/**
 * index.js — RAG Support Triage Agent CLI
 *
 * Commands:
 *   node code/index.js triage            → runs on support_tickets.csv → output.csv
 *   node code/index.js sample            → runs on sample_support_tickets.csv → sample_output.csv
 *   node code/index.js interactive       → REPL mode
 */

import 'dotenv/config';
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";
import { program } from "commander";
import chalk from "chalk";
import ora from "ora";

import { parseCSV, loadCorpus } from "./loader.js";
import { buildRetriever } from "./retriever.js";
import { resolveCompany } from "./inferCompany.js";
import { checkEscalation, buildEscalationResult } from "./escalation.js";
import { triageTicket } from "./agent.js";
import { writeCSV, writeJSON, formatResultForTerminal } from "./output.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");

// Free tier = ~8 req/min → need at least 7.5s between calls.
// We use 8s to be safe. Escalated tickets don't hit the LLM so those are free.
const INTER_REQUEST_DELAY = 200; // fast mode
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// ── Banner ────────────────────────────────────────────────────────────────────
function printBanner() {
  console.log(chalk.bold.cyan(`
╔══════════════════════════════════════════════════╗
║       RAG Support Triage Agent  v2.0.0           ║
║   HackerRank · Claude · Visa  —  by Bilal        ║
╚══════════════════════════════════════════════════╝
`));
}

// ── Terminal helpers ──────────────────────────────────────────────────────────
function printTicketHeader(i, total, ticket, company) {
  console.log(
    chalk.bold(`\n[${i + 1}/${total}] `) +
    chalk.blue(`Company: ${chalk.bold(company.toUpperCase())}`) + "  " +
    chalk.dim(`Subject: ${ticket.Subject || "(none)"}`)
  );
  const preview = (ticket.Issue || "").slice(0, 120).replace(/\n/g, " ");
  console.log(chalk.dim("  Issue: ") + preview + (ticket.Issue?.length > 120 ? "…" : ""));
}

function printResult(result) {
  for (const { label, value, color } of formatResultForTerminal(result)) {
    const fn = chalk[color] ?? chalk.white;
    console.log(`  ${chalk.bold(label.padEnd(14))} ${fn(value)}`);
  }
}

// ── Sample comparison helper ──────────────────────────────────────────────────
function compareSampleOutput(results, sampleTickets) {
  console.log(chalk.bold.white("\n──────────────────── SAMPLE COMPARISON ────────────────────\n"));

  let statusCorrect = 0, rtCorrect = 0;

  for (let i = 0; i < results.length; i++) {
    const got      = results[i];
    const expected = sampleTickets[i];

    // Sample CSV columns: Response, Product Area, Status, Request Type
    const expStatus = (expected["Status"] || "").trim().toLowerCase();
    const expRT     = (expected["Request Type"] || "").trim().toLowerCase().replace(" ", "_");
    const gotStatus = got.status.toLowerCase();
    const gotRT     = got.request_type.toLowerCase();

    const statusOK = expStatus === gotStatus;
    const rtOK     = expRT     === gotRT;
    if (statusOK) statusCorrect++;
    if (rtOK)     rtCorrect++;

    const statusIcon = statusOK ? chalk.green("✓") : chalk.red("✗");
    const rtIcon     = rtOK     ? chalk.green("✓") : chalk.red("✗");

    console.log(
      chalk.bold(`  Row ${i + 1}: `) +
      `status ${statusIcon} ${chalk.dim(`(got: ${gotStatus}, expected: ${expStatus})`)}` +
      "   " +
      `request_type ${rtIcon} ${chalk.dim(`(got: ${gotRT}, expected: ${expRT})`)}`
    );
  }

  const total = results.length;
  console.log(chalk.bold(`\n  Score: `) +
    chalk.green(`status ${statusCorrect}/${total}`) + "  " +
    chalk.cyan(`request_type ${rtCorrect}/${total}`) + "\n"
  );
}

// ── Core pipeline (shared by triage + sample commands) ───────────────────────
async function runPipeline({ ticketsPath, dataDir, outCSV, topK, isSample }) {
  const s1 = ora(chalk.dim("Loading knowledge-base corpus…")).start();
  const corpus = loadCorpus(dataDir);
  s1.succeed(chalk.green(`Loaded ${corpus.length} corpus documents`));

  if (corpus.length === 0) {
    console.log(chalk.yellow("  ⚠  No .md files found in data/ — check the path."));
  }

  const { retrieve } = buildRetriever(corpus);

  const s2 = ora(chalk.dim("Reading tickets…")).start();
  let tickets;
  try {
    tickets = await parseCSV(ticketsPath);
    s2.succeed(chalk.green(`Loaded ${tickets.length} tickets from ${path.basename(ticketsPath)}`));
  } catch (err) {
    s2.fail(chalk.red(`Cannot read tickets: ${err.message}`));
    process.exit(1);
  }

  const allResults = [];
  let llmCallCount = 0;

  console.log(chalk.bold.white("\n──────────────────────── TRIAGE ────────────────────────\n"));

  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];

    // Normalise column names (CSV headers vary in case)
    const issue   = ticket.Issue   || ticket.issue   || "";
    const subject = ticket.Subject || ticket.subject || "";
    const rawCo   = ticket.Company || ticket.company || "None";
    const company = resolveCompany(rawCo, `${issue} ${subject}`);
    const enriched = { Issue: issue, Subject: subject, Company: company };

    printTicketHeader(i, tickets.length, enriched, company);

    // Pre-LLM escalation check (free, no API call)
    const { escalate, reason, rt } = checkEscalation(enriched);

    let result;

    if (escalate) {
      const s = ora(chalk.dim("  Pre-filter: escalating…")).start();
      result = buildEscalationResult(reason, rt);
      s.warn(chalk.red(`  ⚠  ESCALATED (pre-filter) — ${reason}`));
    } else {
      // Add delay before every LLM call (except the first)
      if (llmCallCount > 0) {
        process.stdout.write(chalk.dim(`  ⏸  Waiting ${INTER_REQUEST_DELAY / 1000}s between calls…`));
        await sleep(INTER_REQUEST_DELAY);
        process.stdout.write("\r" + " ".repeat(50) + "\r"); // clear line
      }

      const snippets = retrieve(enriched, topK);
      const s = ora(chalk.dim(`  Retrieving ${snippets.length} snippets → LLM…`)).start();

      try {
        result = await triageTicket(enriched, snippets);
        llmCallCount++;
        s.succeed(chalk.green(`  ✓  ${result.status.toUpperCase()} — ${result.request_type}`));
      } catch (err) {
        s.fail(chalk.red(`  ✗  LLM error: ${err.message}`));
        result = {
          status:        "escalated",
          product_area:  "unknown",
          response:      "We were unable to process this request automatically. A support agent will assist you shortly.",
          justification: `Processing failed: ${err.message.slice(0, 100)}`,
          request_type:  "product_issue",
        };
      }
    }

    printResult(result);

    allResults.push({
      issue, subject, company,
      response:      result.response,
      product_area:  result.product_area,
      status:        result.status,
      request_type:  result.request_type,
      justification: result.justification,
    });
  }

  // Write output
  const outJSON = outCSV.replace(/\.csv$/, ".json");
  console.log(chalk.bold.white("\n──────────────────────── OUTPUT ────────────────────────\n"));
  writeCSV(allResults,  outCSV);
  writeJSON(allResults, outJSON);
  console.log(chalk.green(`  ✓ CSV  → ${outCSV}`));
  console.log(chalk.green(`  ✓ JSON → ${outJSON}`));

  // Summary
  const replied   = allResults.filter((r) => r.status === "replied").length;
  const escalated = allResults.filter((r) => r.status === "escalated").length;
  console.log(
    chalk.bold(`\n  Summary: `) +
    chalk.green(`${replied} replied`) + "  " +
    chalk.red(`${escalated} escalated`) + "  " +
    chalk.dim(`(${allResults.length} total)\n`)
  );

  // If running on sample, show comparison
  if (isSample) {
    compareSampleOutput(allResults, tickets);
  }

  return allResults;
}

// ── Triage command (real tickets) ─────────────────────────────────────────────
async function runTriage(options) {
  printBanner();
  console.log(chalk.bold.yellow("  Mode: PRODUCTION  →  support_tickets.csv\n"));
  await runPipeline({
    ticketsPath: options.tickets ?? path.join(ROOT, "support_tickets", "support_tickets.csv"),
    dataDir:     options.data    ?? path.join(ROOT, "data"),
    outCSV:      options.out     ?? path.join(ROOT, "support_tickets", "output.csv"),
    topK:        parseInt(options.topK ?? "6", 10),
    isSample:    false,
  });
}

// ── Sample command (test against known answers) ───────────────────────────────
async function runSample(options) {
  printBanner();
  console.log(chalk.bold.cyan("  Mode: SAMPLE TEST  →  sample_support_tickets.csv\n"));
  console.log(chalk.dim("  This runs your agent on the sample file and compares against expected outputs.\n"));
  await runPipeline({
    ticketsPath: options.tickets ?? path.join(ROOT, "support_tickets", "sample_support_tickets.csv"),
    dataDir:     options.data    ?? path.join(ROOT, "data"),
    outCSV:      options.out     ?? path.join(ROOT, "support_tickets", "sample_output.csv"),
    topK:        parseInt(options.topK ?? "6", 10),
    isSample:    true,
  });
}

// ── Interactive command ───────────────────────────────────────────────────────
async function runInteractive(options) {
  printBanner();
  console.log(chalk.cyan("  Interactive mode. Type 'exit' to quit.\n"));

  const dataDir = options.data ?? path.join(ROOT, "data");
  const topK    = parseInt(options.topK ?? "6", 10);

  const s = ora(chalk.dim("Loading corpus…")).start();
  const corpus = loadCorpus(dataDir);
  s.succeed(chalk.green(`Loaded ${corpus.length} documents`));
  const { retrieve } = buildRetriever(corpus);

  const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (p) => new Promise((res) => rl.question(p, res));

  while (true) {
    const issue   = await ask(chalk.bold.cyan("\n  Issue   : "));
    if (issue.trim().toLowerCase() === "exit") break;
    const subject = await ask(chalk.bold.cyan("  Subject : "));
    const company = await ask(chalk.bold.cyan("  Company (Claude/HackerRank/Visa/None): "));
    const resolved = resolveCompany(company, `${issue} ${subject}`);
    const enriched = { Issue: issue, Subject: subject, Company: resolved };

    const { escalate, reason, rt } = checkEscalation(enriched);
    if (escalate) {
      const r = buildEscalationResult(reason, rt);
      console.log(chalk.red(`\n  ⚠  AUTO-ESCALATED\n  Response: ${r.response}`));
      continue;
    }

    const snippets = retrieve(enriched, topK);
    const spinner  = ora(chalk.dim("  Thinking…")).start();
    try {
      const result = await triageTicket(enriched, snippets);
      spinner.stop();
      console.log("\n" + chalk.bold("  RESULT:"));
      for (const { label, value, color } of formatResultForTerminal(result)) {
        console.log(`  ${chalk.bold(label.padEnd(14))} ${(chalk[color] ?? chalk.white)(value)}`);
      }
    } catch (err) {
      spinner.fail(chalk.red(`  Error: ${err.message}`));
    }
  }

  rl.close();
  console.log(chalk.dim("\n  Goodbye!\n"));
}

// ── Commander ─────────────────────────────────────────────────────────────────
program.name("triage-agent").description("RAG support triage for HackerRank, Claude, Visa").version("2.0.0");

program.command("triage")
  .description("Process support_tickets.csv → output.csv")
  .option("-t, --tickets <path>", "Custom input CSV path")
  .option("-d, --data <path>",    "Corpus data/ directory")
  .option("-o, --out <path>",     "Output CSV path")
  .option("-k, --top-k <num>",    "Snippets to retrieve", "3")
  .action(runTriage);

program.command("sample")
  .description("Test against sample_support_tickets.csv and compare with expected answers")
  .option("-t, --tickets <path>", "Custom sample CSV path")
  .option("-d, --data <path>",    "Corpus data/ directory")
  .option("-o, --out <path>",     "Output CSV path", path.join(ROOT, "support_tickets", "sample_output.csv"))
  .option("-k, --top-k <num>",    "Snippets to retrieve", "3")
  .action(runSample);

program.command("interactive")
  .description("Interactive REPL mode")
  .option("-d, --data <path>",    "Corpus data/ directory")
  .option("-k, --top-k <num>",    "Snippets to retrieve", "3")
  .action(runInteractive);

if (process.argv.length <= 2) process.argv.push("triage");
program.parse(process.argv);