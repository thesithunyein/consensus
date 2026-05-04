#!/usr/bin/env node
/**
 * Executable policy: Consensus N-of-M Ed25519 quorum.
 *
 * Denies any transaction unless a matching pending proposal in the Consensus
 * state directory carries >= threshold valid Ed25519 signatures from the
 * registered member set over a canonical intent hash.
 *
 * policy_config fields read:
 *   quorum: true                              // opt-in
 *   state_dir?: string                        // default $HOME/.consensus
 *
 * Runtime channel (bot -> policy):
 *   env ZERION_CONSENSUS_NONCE  or  <state_dir>/current.nonce file
 *
 * Threat model & full spec: docs/CONSENSUS-POLICY-SPEC.md
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { homedir } from "node:os";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import { runPolicyFromStdin } from "../utils/common/prompt.js";

function stateDir(cfg) {
  return cfg.state_dir || process.env.CONSENSUS_STATE_DIR || join(homedir(), ".consensus");
}

function loadMembers(dir) {
  const p = join(dir, "members.json");
  if (!existsSync(p)) throw new Error(`members.json missing at ${p}`);
  const m = JSON.parse(readFileSync(p, "utf8"));
  if (!Array.isArray(m.members) || m.members.length === 0)
    throw new Error("members.json has no members");
  if (typeof m.threshold !== "number" || m.threshold < 1 || m.threshold > m.members.length)
    throw new Error(`invalid threshold ${m.threshold} for ${m.members.length} members`);
  return m;
}

function readNonce(dir) {
  if (process.env.ZERION_CONSENSUS_NONCE) return process.env.ZERION_CONSENSUS_NONCE.trim();
  const p = join(dir, "current.nonce");
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  return null;
}

function findProposalByNonce(dir, nonce) {
  const pending = join(dir, "pending");
  if (!existsSync(pending)) return null;
  const now = Date.now();
  const hits = readdirSync(pending)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const full = join(pending, f);
      try {
        return { p: JSON.parse(readFileSync(full, "utf8")), mtime: statSync(full).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((x) => x && x.p.op?.nonce === nonce && x.p.expiresAt > now)
    .sort((a, b) => b.mtime - a.mtime);
  return hits[0]?.p ?? null;
}

export function check(ctx) {
  const cfg = ctx.policy_config || {};
  if (!cfg.quorum) return { allow: true };

  const dir = stateDir(cfg);

  let members;
  try { members = loadMembers(dir); }
  catch (e) { return { allow: false, reason: `quorum fail-closed: ${e.message}` }; }

  const nonce = readNonce(dir);
  if (!nonce) {
    return {
      allow: false,
      reason:
        "quorum: no ZERION_CONSENSUS_NONCE env or current.nonce file. " +
        "This transaction must be executed via the Consensus bot, not by hand.",
    };
  }

  const proposal = findProposalByNonce(dir, nonce);
  if (!proposal) {
    return {
      allow: false,
      reason: `quorum: no non-expired proposal found for nonce ${nonce.slice(0, 10)}…`,
    };
  }
  if (!proposal.hash) {
    return { allow: false, reason: "quorum: proposal missing canonical hash" };
  }

  const memberByName = new Map(members.members.map((m) => [m.name, m]));
  const msg = naclUtil.decodeUTF8(proposal.hash);
  const valid = new Set();
  for (const a of proposal.approvals || []) {
    const m = memberByName.get(a.member);
    if (!m) continue;
    try {
      const sig = naclUtil.decodeBase64(a.sig);
      const pk = naclUtil.decodeBase64(m.pubkey);
      if (nacl.sign.detached.verify(msg, sig, pk)) valid.add(m.name);
    } catch { /* fall-through: invalid sig ignored */ }
  }

  if (valid.size < members.threshold) {
    return {
      allow: false,
      reason:
        `quorum: ${valid.size}/${members.threshold} valid signatures ` +
        `(need ${members.threshold} of ${members.members.length}). ` +
        `Signers: ${[...valid].join(", ") || "none"}.`,
    };
  }
  return { allow: true };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPolicyFromStdin(check);
}
