/**
 * output.js
 * Writes triage results to output.csv in the exact schema the hackathon expects:
 *   issue, subject, company, response, product_area, status, request_type, justification
 */

import fs from "fs";
import path from "path";

/**
 * Safely escape a value for CSV: wrap in quotes, escape internal quotes.
 */
function csvEscape(val) {
  const str = (val ?? "").toString().replace(/"/g, '""');
  return `"${str}"`;
}

// ── Exact column order from sample_support_tickets.csv ───────────────────────
// sample has: Issue,Subject,Company,Response,Product Area,Status,Request Type
// output.csv header observed: issue,subject,company,response,product_area,status,request_type,justification
const CSV_HEADERS = [
  "issue",
  "subject",
  "company",
  "response",
  "product_area",
  "status",
  "request_type",
  "justification",
];

/**
 * Write results to the hackathon output.csv format.
 * @param {object[]} results - each has: issue, subject, company, status, product_area, response, justification, request_type
 * @param {string}   filePath
 */
export function writeCSV(results, filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const lines = [CSV_HEADERS.join(",")];

  for (const r of results) {
    const row = [
      csvEscape(r.issue),
      csvEscape(r.subject),
      csvEscape(r.company),
      csvEscape(r.response),
      csvEscape(r.product_area),
      csvEscape(r.status),
      csvEscape(r.request_type),
      csvEscape(r.justification),
    ];
    lines.push(row.join(","));
  }

  fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
}

/**
 * Write results to a JSON file (for debugging).
 */
export function writeJSON(results, filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(results, null, 2), "utf-8");
}

/**
 * Format a result for terminal display.
 */
export function formatResultForTerminal(result) {
  return [
    { label: "Status",        value: result.status,        color: result.status === "escalated" ? "red" : "green" },
    { label: "Product Area",  value: result.product_area,  color: "cyan"   },
    { label: "Request Type",  value: result.request_type,  color: "yellow" },
    { label: "Response",      value: (result.response || "").slice(0, 200), color: "white" },
    { label: "Justification", value: result.justification, color: "gray"   },
  ];
}