#!/usr/bin/env node
/**
 * doctor.mjs — Consensus environment health check.
 *
 * Walks every prerequisite the bot needs and prints a red/green checklist.
 * Safe to re-run; read-only except for creating the state directory.
 */

import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import "dotenv/config";

const STATE_DIR = process.env.CONSENSUS_STATE_DIR || join(homedir(), ".consensus");
for (const sub of ["", "pending", "executed", "keys"]) {
  const p = join(STATE_DIR, sub);
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

const checks = [];
function ok(name, detail = "")  { checks.push({ s: "✅", name, detail }); }
function bad(name, detail)      { checks.push({ s: "❌", name, detail }); }
function warn(name, detail)     { checks.push({ s: "⚠️ ", name, detail }); }

/* --- 1. Node + pnpm --- */
const node = process.versions.node.split(".").map(Number);
if (node[0] >= 20) ok("Node >= 20", `v${process.versions.node}`);
else               bad("Node >= 20", `found v${process.versions.node}`);

try {
  const r = spawnSync("pnpm", ["--version"], { encoding: "utf8" });
  if (r.status === 0) ok("pnpm installed", `v${r.stdout.trim()}`);
  else bad("pnpm installed", "not on PATH");
} catch { bad("pnpm installed", "not on PATH"); }

/* --- 2. Zerion CLI binary --- */
try {
  const r = spawnSync("node", ["./cli/zerion.js", "--version"], { encoding: "utf8" });
  if (r.status === 0) ok("zerion CLI", r.stdout.trim());
  else warn("zerion CLI", `exit ${r.status}: ${r.stderr.trim().slice(0, 120)}`);
} catch (e) { bad("zerion CLI", String(e)); }

/* --- 3. Env vars --- */
const REQUIRED = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_GROUP_CHAT_ID",
  "ZERION_API_KEY",
  "ZERION_AGENT_TOKEN",
  "ZERION_WALLET",
];
for (const k of REQUIRED) {
  if (process.env[k]) ok(`env ${k}`, `(${process.env[k].slice(0, 10)}…)`);
  else bad(`env ${k}`, "missing in .env");
}

/* --- 4. Members.json --- */
const membersPath = join(STATE_DIR, "members.json");
if (existsSync(membersPath)) {
  try {
    const m = JSON.parse(readFileSync(membersPath, "utf8"));
    if (typeof m.threshold === "number" && Array.isArray(m.members) && m.members.length >= m.threshold) {
      ok(`members.json (${m.members.length} members, threshold ${m.threshold})`);
    } else {
      bad("members.json shape", "threshold or members invalid");
    }
  } catch (e) { bad("members.json parse", String(e)); }
} else {
  bad("members.json", `missing at ${membersPath} — run: pnpm consensus:gen-keys <a> <b> <c> --threshold 2`);
}

/* --- 5. Private keys warning --- */
const keysDir = join(STATE_DIR, "keys");
if (existsSync(keysDir)) {
  try {
    const fs = await import("node:fs");
    const n = fs.readdirSync(keysDir).filter((f) => f.endsWith(".privkey.b64")).length;
    if (n > 0) warn("private keys on disk", `${n} file(s) in ${keysDir} — DM them to members and delete.`);
  } catch { /* ignore */ }
}

/* --- 6. Quorum tests --- */
try {
  const r = spawnSync("node", ["--test", "cli/policies/__tests__/quorum.test.mjs"],
                     { encoding: "utf8", timeout: 30_000 });
  if (r.status === 0) ok("quorum unit tests", "all passing");
  else bad("quorum unit tests", `exit ${r.status}\n${(r.stdout + r.stderr).slice(-500)}`);
} catch (e) { bad("quorum unit tests", String(e)); }

/* --- report --- */
const bads = checks.filter((c) => c.s === "❌");
const warns = checks.filter((c) => c.s === "⚠️ ");
const oks  = checks.filter((c) => c.s === "✅");

console.log("\n=== Consensus doctor ===\n");
for (const c of checks) console.log(`${c.s}  ${c.name}${c.detail ? "  " + c.detail : ""}`);
console.log(`\n${oks.length} ok, ${warns.length} warn, ${bads.length} failing.\n`);

if (bads.length === 0) {
  console.log("🟢 Ready to run:  pnpm consensus:bot");
  process.exit(0);
}
console.log("🔴 Fix the ❌ items above, then re-run:  pnpm consensus:doctor");
process.exit(1);
