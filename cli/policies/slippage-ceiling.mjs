#!/usr/bin/env node
/**
 * Executable policy: rejects proposals whose declared slippage exceeds a cap.
 *
 * The Consensus bot records the `slippageBps` it will pass to the CLI when
 * building the proposal. Members sign that value. If it exceeds the
 * policy's max_bps, reject — the group can then re-propose tighter.
 *
 * policy_config fields:
 *   max_slippage_bps?: number
 *   state_dir?: string
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

export function check(ctx) {
  const cfg = ctx.policy_config || {};
  const max = Number(cfg.max_slippage_bps);
  if (!Number.isFinite(max)) return { allow: true };

  const p = currentProposal(stateDir(cfg));
  if (!p) return { allow: false, reason: "slippage: no active proposal (fail-closed)" };

  const bps = Number(p.op?.slippageBps);
  if (!Number.isFinite(bps)) {
    return { allow: false, reason: "slippage: proposal missing slippageBps (fail-closed)" };
  }
  if (bps > max) {
    return { allow: false, reason: `slippage: ${bps} bps exceeds ceiling ${max} bps` };
  }
  return { allow: true };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPolicyFromStdin(check);
}
