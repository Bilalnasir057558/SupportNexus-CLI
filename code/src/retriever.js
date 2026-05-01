/**
 * retriever.js
 * Builds a Fuse.js index over the corpus and exposes a retrieve() function
 * that returns the top-k most relevant documents for a given ticket.
 */

import Fuse from "fuse.js";

// Fuse.js options – search in title, category, and content.
const FUSE_OPTIONS = {
  includeScore: true,
  threshold: 0.5,         // 0 = perfect match, 1 = match anything
  minMatchCharLength: 3,
  keys: [
    { name: "title",    weight: 0.4 },
    { name: "category", weight: 0.2 },
    { name: "content",  weight: 0.4 },
  ],
};

/**
 * Build a retrieval index from the corpus.
 * @param {object[]} corpus - Array produced by loadCorpus()
 * @returns {{ retrieve: Function }}
 */
export function buildRetriever(corpus) {
  const fuseIndex = new Fuse(corpus, FUSE_OPTIONS);

  /**
   * Retrieve relevant documents for a ticket.
   *
   * Strategy:
   *  1. Filter corpus to the ticket's company (exact match, case-insensitive).
   *  2. Run a fuzzy search over that subset using the ticket issue text + subject.
   *  3. If fewer than `topK` hits are found at the given threshold, widen to full corpus.
   *
   * @param {object} ticket  - { Issue, Subject, Company }
   * @param {number} topK    - Maximum number of snippets to return (default 5)
   * @returns {{ id: string, company: string, category: string, title: string, snippet: string }[]}
   */
  function retrieve(ticket, topK = 5) {
    const query = [ticket.Issue, ticket.Subject].filter(Boolean).join(" ").trim();
    const company = (ticket.Company || "").toLowerCase();

    // Company-specific sub-index for precision
    let companyDocs = corpus.filter((d) => d.company === company);

    // If company is "none" / unknown / empty, search entire corpus
    if (!company || company === "none" || companyDocs.length === 0) {
      companyDocs = corpus;
    }

    const localFuse = new Fuse(companyDocs, FUSE_OPTIONS);
    let results = localFuse.search(query, { limit: topK });

    // Fallback: broaden to full corpus if we got nothing useful
    if (results.length === 0) {
      results = fuseIndex.search(query, { limit: topK });
    }

    return results.map(({ item }) => ({
      id: item.id,
      company: item.company,
      category: item.category,
      title: item.title,
      // Trim content to ~800 chars so we don't blow the context window
      snippet: item.content.slice(0, 800).replace(/\s+/g, " ").trim(),
    }));
  }

  return { retrieve };
}
