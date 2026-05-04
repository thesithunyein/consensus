#!/usr/bin/env node
/**
 * list-executed.mjs — pretty-prints all executed proposals with Basescan
 * links. Used for pasting tx hashes into the Superteam Earn submission.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const STATE_DIR = process.env.CONSENSUS_STATE_DIR || join(homedir(), ".consensus");
const dir = join(STATE_DIR, "executed");
if (!existsSync(dir)) {
  console.log("(no executed proposals yet)");
  process.exit(0);
}

const EXPLORER = {
  ethereum: "https://etherscan.io/tx/",
  base:     "https://basescan.org/tx/",
  arbitrum: "https://arbiscan.io/tx/",
  optimism: "https://optimistic.etherscan.io/tx/",
  polygon:  "https://polygonscan.com/tx/",
  solana:   "https://solscan.io/tx/",
};

const rows = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")))
  .sort((a, b) => (b.executedAt ?? 0) - (a.executedAt ?? 0));

if (rows.length === 0) {
  console.log("(no executed proposals yet)");
  process.exit(0);
}

console.log(`\n## Consensus — executed proposals (${rows.length})\n`);
for (const r of rows) {
  const o = r.op ?? {};
  const summary = o.op === "swap"   ? `swap ${o.amount} ${o.from?.symbol} → ${o.to?.symbol}` :
                  o.op === "bridge" ? `bridge ${o.amount} ${o.from?.symbol} ${o.chain} → ${o.toChain}` :
                                      `send ${o.amount} ${o.from?.symbol}`;
  const when = r.executedAt ? new Date(r.executedAt).toISOString() : "?";
  const usd = Number.isFinite(r.amountUsd) ? ` ($${r.amountUsd.toFixed(2)})` : "";
  const url = (EXPLORER[o.chain] ?? "") + (r.txHash ?? "");
  console.log(`- **${r.id}** — ${summary} on \`${o.chain}\`${usd} — ${when}`);
  console.log(`  - tx: ${url}`);
  console.log(`  - signers: ${(r.approvals ?? []).map((a) => a.member).join(", ") || "n/a"}`);
}
