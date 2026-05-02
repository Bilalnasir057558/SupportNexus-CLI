/**
 * loader.js
 * Handles reading support_tickets.csv and all corpus .md files from the data/ directory.
 */

import fs from "fs";
import path from "path";
import { createReadStream } from "fs";
import csvParser from "csv-parser";

/**
 * Parse a CSV file into an array of row objects.
 * @param {string} filePath - Absolute or relative path to the CSV.
 * @returns {Promise<object[]>}
 */
export function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    createReadStream(filePath)
      .on("error", reject)
      .pipe(csvParser())
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

/**
 * Recursively walk a directory and return all file paths matching an extension.
 * @param {string} dir
 * @param {string} ext - e.g. ".md"
 * @returns {string[]}
 */
function walkDir(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full, ext));
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Load the knowledge-base corpus from the data/ directory.
 * Each document gets:
 *   - id: relative path used as a stable identifier
 *   - company: inferred from top-level folder name (claude | hackerrank | visa)
 *   - category: second-level folder name (e.g. "pricing-and-billing")
 *   - title: file name without extension
 *   - content: full raw text
 *
 * @param {string} dataDir - Path to the data/ directory.
 * @returns {{ id: string, company: string, category: string, title: string, content: string }[]}
 */
export function loadCorpus(dataDir) {
  const files = walkDir(dataDir, ".md");
  return files.map((filePath) => {
    const rel = path.relative(dataDir, filePath);
    const parts = rel.split(path.sep);

    // parts[0] = company folder  (claude / hackerrank / visa)
    // parts[1] = category folder (or file if flat)
    // parts[last] = filename
    const company = parts[0]?.toLowerCase() ?? "unknown";
    const category = parts.length > 2 ? parts[1] : "general";
    const title = path.basename(filePath, ".md");

    let content = "";
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      content = "";
    }

    content = cleanContent(content);

    return { id: rel, company, category, title, content, searchContent: content.slice(0, 1000) };
  });
}

/**
 * Clean the content by removing YAML frontmatter and image URLs.
 * @param {string} content
 * @returns {string}
 */
function cleanContent(content) {
  // Remove YAML frontmatter
  content = content.replace(/^---[\s\S]*?---\n/, "");

  // Remove image URLs
  content = content.replace(/!\[.*?\]\(.*?\)/g, "");

  return content.trim();
}
