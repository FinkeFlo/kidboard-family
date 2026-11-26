#!/usr/bin/env node
// Blocks terms that must never appear in the repository or in commit messages.
// Terms are stored base64-encoded so this file does not contain them itself.
// Usage: node scripts/check-forbidden-terms.mjs            -> scan all tracked files
//        node scripts/check-forbidden-terms.mjs --msg FILE -> scan a commit message file
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const TERMS = ["ZGFlbHk="].map((t) =>
  Buffer.from(t, "base64").toString("utf8").toLowerCase(),
);

function findTerm(text) {
  const lower = text.toLowerCase();
  return TERMS.find((term) => lower.includes(term));
}

const args = process.argv.slice(2);
const hits = [];

if (args[0] === "--msg") {
  if (findTerm(readFileSync(args[1], "utf8"))) hits.push("commit message");
} else {
  const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  for (const file of files) {
    let content;
    try {
      content = readFileSync(file);
    } catch {
      continue; // deleted in the working tree
    }
    if (content.includes(0)) continue; // binary
    if (findTerm(file) || findTerm(content.toString("utf8"))) hits.push(file);
  }
}

if (hits.length > 0) {
  console.error(`Forbidden term found in: ${hits.join(", ")}`);
  process.exit(1);
}
