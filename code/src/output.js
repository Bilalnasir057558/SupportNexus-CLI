/**
 * output.js
 * Formats and writes triage results as JSON and/or CSV.
 */

import fs from "fs";
import path from "path";

/**
 * Escape a value for CSV output.
 * @param {string|undefined} val
 * @returns {string}
 */
function csvEscape(val) {
  const str = (val ?? "").toString().replace(/"/g, '""');
  return `"${str}"`;
}

const CSV_HEADERS = ["ticket_index", "company", "subject", "status", "product_area", "request_type", "response", "justification"];

/**
 * Write results to a JSON file.
 * @param {object[]} results
 * @param {string}   filePath
 */
export function writeJSON(results, filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(results, null, 2), "utf-8");
}

/**
 * Write results to a CSV file.
 * @param {object[]} results
 * @param {string}   filePath
 */
export function writeCSV(results, filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [CSV_HEADERS.join(",")];
  for (const r of results) {
    const row = [
      csvEscape(r.ticket_index),
      csvEscape(r.company),
      csvEscape(r.subject),
      csvEscape(r.status),
      csvEscape(r.product_area),
      csvEscape(r.request_type),
      csvEscape(r.response),
      csvEscape(r.justification),
    ];
    lines.push(row.join(","));
  }
  fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
}

/**
 * Format a single result object for pretty terminal printing.
 * Returns an array of { label, value, color } entries.
 *
 * @param {object} result
 * @returns {{ label: string, value: string, color: string }[]}
 */
export function formatResultForTerminal(result) {
  return [
    { label: "Status",       value: result.status,       color: result.status === "escalated" ? "red" : "green" },
    { label: "Product Area", value: result.product_area, color: "cyan" },
    { label: "Request Type", value: result.request_type, color: "yellow" },
    { label: "Response",     value: result.response,     color: "white" },
    { label: "Justification",value: result.justification,color: "gray" },
  ];
}
