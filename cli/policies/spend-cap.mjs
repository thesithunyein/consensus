#!/usr/bin/env node
/**
 * Executable policy: per-tx USD ceiling + rolling 24h aggregate cap.
 *
 * policy_config fields:
 *   spend_cap_per_tx_usd?: number             // reject if proposal.amountUsd exceeds this
 *   spend_cap_24h_usd?: number                // reject if sum of executed 24h + this tx exceeds
 *   state_dir?: string                        // default $HOME/.consensus
 *
 * Reads the active proposal (by nonce) for amountUsd, and the executed/
 * ledger for the 24h aggregate. Fail-closed when amountUsd cannot be read.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { homedir } from "node:os";
import { runPolicyFromStdin } from "../utils/common/prompt.js";

function stateDir(cfg) {
  return cfg.state_dir || process.env.CONSENSUS_STATE_DIR || join(homedir(), ".consensus");
}

function currentProposal(dir) {
  const nonce = process.env.ZERION_CONSENSUS_NONCE
    || (existsSync(join(dir, "current.nonce"))
        ? readFileSync(join(dir, "current.nonce"), "utf8").trim()
        : null);
  if (!nonce) return null;
  const pending = join(dir, "pending");
  if (!existsSync(pending)) return null;
  const now = Date.now();
  for (const f of readdirSync(pending)) {
    if (!f.endsWith(".json")) continue;
    try {
      const p = JSON.parse(readFileSync(join(pending, f), "utf8"));
      if (p.op?.nonce === nonce && p.expiresAt > now) return p;
    } catch { /* ignore */ }
  }
  return null;
}

function sumExecuted24h(dir) {
  const d = join(dir, "executed");
  if (!existsSync(d)) return 0;
  const cutoff = Date.now() - 24 * 3600_000;
  let total = 0;
  for (const f of readdirSync(d)) {
    if (!f.endsWith(".json")) continue;
    try {
      const r = JSON.parse(readFileSync(join(d, f), "utf8"));
      if (r.executedAt >= cutoff && Number.isFinite(r.amountUsd)) total += r.amountUsd;
    } catch { /* ignore corrupt */ }
  }
  return total;
}

export function check(ctx) {
  const cfg = ctx.policy_config || {};
  const perTx = Number(cfg.spend_cap_per_tx_usd);
  const rolling = Number(cfg.spend_cap_24h_usd);
  if (!Number.isFinite(perTx) && !Number.isFinite(rolling)) return { allow: true };

  const dir = stateDir(cfg);
  const proposal = currentProposal(dir);
  if (!proposal) {
    return { allow: false, reason: "spend-cap: no active proposal to price (fail-closed)" };
  }
  const usd = Number(proposal.op?.amountUsd);
  if (!Number.isFinite(usd)) {
    return { allow: false, reason: "spend-cap: proposal has no amountUsd (fail-closed)" };
  }

  if (Number.isFinite(perTx) && usd > perTx) {
    return {
      allow: false,
      reason: `spend-cap: $${usd.toFixed(2)} exceeds per-tx cap $${perTx}`,
    };
  }
  if (Number.isFinite(rolling)) {
    const prior = sumExecuted24h(dir);
    if (prior + usd > rolling) {
      return {
        allow: false,
        reason:
          `spend-cap: 24h total would be $${(prior + usd).toFixed(2)} ` +
          `> cap $${rolling} (prior $${prior.toFixed(2)} + this $${usd.toFixed(2)})`,
      };
    }
  }
  return { allow: true };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPolicyFromStdin(check);
}
