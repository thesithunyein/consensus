import { readFileSync, writeFileSync, readdirSync, existsSync, renameSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { join } from "node:path";
import { STATE_DIR } from "./config.mjs";

const PENDING = join(STATE_DIR, "pending");
const EXECUTED = join(STATE_DIR, "executed");

/**
 * Canonical operation hash.
 *
 * IMPORTANT — members sign this hash, so every field here constrains what the
 * bot is allowed to execute on their behalf. The quorum policy verifies the
 * stored sigs against `proposal.hash`; it does NOT recompute this itself, so
 * changes here only require the bot to stay consistent (no CLI-side drift).
 */
export function canonicalHash(op) {
  const canonical = {
    op: op.op,
    wallet: op.wallet,
    chain: op.chain,
    toChain: op.toChain ?? null,
    fromSymbol: op.from?.symbol?.toLowerCase() ?? null,
    toSymbol: op.to?.symbol?.toLowerCase() ?? null,
    amount: String(op.amount),
    amountUsd: op.amountUsd != null ? Number(op.amountUsd).toFixed(2) : null,
    slippageBps: op.slippageBps != null ? Number(op.slippageBps) : null,
    destAddress: op.destAddress?.toLowerCase() ?? null,
    nonce: op.nonce,
  };
  const json = JSON.stringify(canonical, Object.keys(canonical).sort());
  return createHash("sha256").update(json).digest("hex");
}

export function newId() {
  return randomBytes(4).toString("hex");
}

export function createProposal({ op, ttlSec, proposedBy }) {
  const id = newId();
  const nonce = randomBytes(8).toString("hex");
  const full = { ...op, nonce };
  const hash = canonicalHash(full);
  const proposal = {
    id,
    createdAt: Date.now(),
    expiresAt: Date.now() + ttlSec * 1000,
    proposedBy,
    op: full,
    hash,
    approvals: [],
    rejections: [],
    status: "pending",
  };
  writeFileSync(join(PENDING, `${id}.json`), JSON.stringify(proposal, null, 2));
  return proposal;
}

export function loadProposal(id) {
  const p = join(PENDING, `${id}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

export function saveProposal(p) {
  writeFileSync(join(PENDING, `${p.id}.json`), JSON.stringify(p, null, 2));
}

export function markExecuted(p, result) {
  const final = { ...p, status: "executed", executedAt: Date.now(), ...result };
  if (final.amountUsd == null && p.op?.amountUsd != null) final.amountUsd = Number(p.op.amountUsd);
  writeFileSync(join(EXECUTED, `${p.id}.json`), JSON.stringify(final, null, 2));
  try { renameSync(join(PENDING, `${p.id}.json`), join(PENDING, `${p.id}.json.done`)); } catch {}
  return final;
}

export function listPending() {
  if (!existsSync(PENDING)) return [];
  return readdirSync(PENDING)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(PENDING, f), "utf8")))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function listExecuted(n = 10) {
  if (!existsSync(EXECUTED)) return [];
  return readdirSync(EXECUTED)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(EXECUTED, f), "utf8")))
    .sort((a, b) => b.executedAt - a.executedAt)
    .slice(0, n);
}
