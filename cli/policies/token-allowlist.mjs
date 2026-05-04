#!/usr/bin/env node
/**
 * Executable policy: enforces a per-chain token symbol allowlist against the
 * declared tokens in the active Consensus proposal.
 *
 * policy_config:
 *   token_allowlist: { "base": ["USDC","ETH"], "ethereum": ["USDC","ETH"] }
 *   state_dir?: string
 *
 * Complements the existing `allowlist.mjs` (which restricts tx.to router
 * addresses) — this one gates the high-level symbols the group may trade.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
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
  for (const f of readdirSync(pending)) {
    if (!f.endsWith(".json")) continue;
    try {
      const p = JSON.parse(readFileSync(join(pending, f), "utf8"));
      if (p.op?.nonce === nonce) return p;
    } catch { /* ignore */ }
  }
  return null;
}

const U = (s) => (s ?? "").toUpperCase();

export function check(ctx) {
  const cfg = ctx.policy_config || {};
  const lists = cfg.token_allowlist;
  if (!lists || typeof lists !== "object") return { allow: true };

  const p = currentProposal(stateDir(cfg));
  if (!p) return { allow: false, reason: "token-allowlist: no active proposal (fail-closed)" };

  const chain = p.op?.chain;
  const toChain = p.op?.toChain ?? chain;
  const listFrom = (lists[chain] ?? []).map(U);
  const listTo = (lists[toChain] ?? []).map(U);

  if (listFrom.length === 0) {
    return { allow: false, reason: `token-allowlist: no tokens approved on ${chain}` };
  }

  const from = U(p.op?.from?.symbol);
  const to = U(p.op?.to?.symbol);
  if (from && !listFrom.includes(from)) {
    return { allow: false, reason: `token-allowlist: ${from} not approved on ${chain}` };
  }
  if (to && !listTo.includes(to)) {
    return { allow: false, reason: `token-allowlist: ${to} not approved on ${toChain}` };
  }
  return { allow: true };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPolicyFromStdin(check);
}
