#!/usr/bin/env node
/**
 * demo.mjs — End-to-end Consensus demo with zero external credentials.
 *
 * Simulates proposals, signs them with the local member keys, invokes each
 * policy's check() function directly, and prints a coloured transcript.
 * This is the same check() contract the real Zerion CLI policy dispatcher
 * uses — the only thing we short-circuit is the OWS signer at the very end.
 *
 * Run:  pnpm consensus:demo
 */

import { readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";

import { check as quorumCheck }   from "../../cli/policies/quorum.mjs";
import { check as spendCheck }    from "../../cli/policies/spend-cap.mjs";
import { check as slippageCheck } from "../../cli/policies/slippage-ceiling.mjs";
import { check as tokensCheck }   from "../../cli/policies/token-allowlist.mjs";
import { check as timeCheck }     from "../../cli/policies/time-window.mjs";

const C = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", d: "\x1b[2m", x: "\x1b[0m", b: "\x1b[1m" };
const pass = (s) => `${C.g}✅  ${s}${C.x}`;
const fail = (s) => `${C.r}🔴  ${s}${C.x}`;

const STATE = process.env.CONSENSUS_STATE_DIR || join(homedir(), ".consensus");
const PENDING = join(STATE, "pending");
mkdirSync(PENDING, { recursive: true });
process.env.CONSENSUS_STATE_DIR = STATE;

if (!existsSync(join(STATE, "members.json"))) {
  console.error(`${C.r}members.json missing at ${STATE}${C.x}`);
  console.error(`${C.y}run first:  pnpm consensus:gen-keys alice bob carol --threshold 2${C.x}`);
  process.exit(1);
}
const { members, threshold } = JSON.parse(readFileSync(join(STATE, "members.json"), "utf8"));

const secrets = {};
for (const m of members) {
  const p = join(STATE, "keys", `${m.name}.privkey.b64`);
  if (existsSync(p)) secrets[m.name] = naclUtil.decodeBase64(readFileSync(p, "utf8").trim());
}
const signers = Object.keys(secrets);
if (signers.length < threshold) {
  console.error(`${C.r}need ≥${threshold} private keys on disk (found: ${signers.join(", ") || "none"})${C.x}`);
  process.exit(1);
}

function canonicalHash(op) {
  const c = {
    op: op.op, wallet: op.wallet, chain: op.chain, toChain: op.toChain ?? null,
    fromSymbol: op.from?.symbol?.toLowerCase() ?? null,
    toSymbol: op.to?.symbol?.toLowerCase() ?? null,
    amount: String(op.amount),
    amountUsd: op.amountUsd != null ? Number(op.amountUsd).toFixed(2) : null,
    slippageBps: op.slippageBps != null ? Number(op.slippageBps) : null,
    destAddress: op.destAddress?.toLowerCase() ?? null,
    nonce: op.nonce,
  };
  return createHash("sha256").update(JSON.stringify(c, Object.keys(c).sort())).digest("hex");
}

function clearPending() {
  for (const f of readdirSync(PENDING)) {
    if (f.endsWith(".json")) rmSync(join(PENDING, f));
  }
}

function writeProposal(op, approverNames, { forgeFor } = {}) {
  const nonce = randomBytes(8).toString("hex");
  const full = { ...op, nonce };
  const hash = canonicalHash(full);
  const approvals = approverNames.map((name) => {
    const secret = (forgeFor === name) ? nacl.sign.keyPair().secretKey : secrets[name];
    return {
      member: name,
      sig: naclUtil.encodeBase64(nacl.sign.detached(naclUtil.decodeUTF8(hash), secret)),
    };
  });
  const id = randomBytes(4).toString("hex");
  writeFileSync(
    join(PENDING, `${id}.json`),
    JSON.stringify({ id, hash, op: full, approvals, createdAt: Date.now(), expiresAt: Date.now() + 3_600_000 }, null, 2),
  );
  process.env.ZERION_CONSENSUS_NONCE = nonce;
}

function summary(op) {
  return `${op.op} ${op.amount} ${op.from.symbol}→${op.to?.symbol ?? "?"} on ${op.chain} ($${op.amountUsd ?? "?"}, ${op.slippageBps ?? "?"}bps)`;
}

function runCase(title, { op, approvers, cfg, forgeFor }, expectAllowed) {
  clearPending();
  writeProposal(op, approvers, { forgeFor });
  const ctx = { policy_config: cfg };
  const results = [
    ["quorum",           quorumCheck(ctx)],
    ["spend-cap",        spendCheck(ctx)],
    ["slippage-ceiling", slippageCheck(ctx)],
    ["token-allowlist",  tokensCheck(ctx)],
    ["time-window",      timeCheck(ctx)],
  ];
  const firstDeny = results.find(([, r]) => !r.allow);
  const allowed = !firstDeny;

  console.log(`\n${C.b}${title}${C.x}`);
  console.log(`${C.d}  op: ${summary(op)}  |  signers: ${approvers.join(", ")}${forgeFor ? " (" + forgeFor + " forged)" : ""}${C.x}`);
  for (const [name, r] of results) {
    const badge = r.allow ? `${C.g}✓${C.x}` : `${C.r}✗${C.x}`;
    const why = r.allow ? "" : ` ${C.d}(${r.reason})${C.x}`;
    console.log(`    ${badge} ${name}${why}`);
  }
  console.log(`  → ${allowed ? pass("FINAL: allowed") : fail("FINAL: blocked by " + firstDeny[0])}`);
  const ok = allowed === expectAllowed;
  if (!ok) console.log(`${C.r}  expected ${expectAllowed ? "allow" : "deny"}, got ${allowed ? "allow" : "deny"}${C.x}`);
  return ok;
}

/* ----- fixture ----- */
const POLICY = {
  quorum: true,
  spend_cap_per_tx_usd: 500,
  spend_cap_24h_usd: 2000,
  max_slippage_bps: 50,
  token_allowlist: { base: ["USDC", "ETH", "WETH", "cbBTC"] },
  // trading_hours_utc omitted so demo works 24/7
};
const baseOp = {
  op: "swap", wallet: "consensus-treasury", chain: "base",
  from: { symbol: "USDC" }, to: { symbol: "ETH" },
  amount: "10", amountUsd: 10, slippageBps: 30,
};

/* ----- run ----- */
console.log(`${C.b}=== Consensus — end-to-end policy demo ===${C.x}`);
console.log(`state: ${STATE}`);
console.log(`members: ${members.map((m) => m.name).join(", ")}  (threshold ${threshold}/${members.length})`);
console.log(`policy: quorum · spend-cap $500/tx, $2k/24h · slippage ≤ 50bps · tokens base:{USDC,ETH,WETH,cbBTC}`);

const results = [];
const two = signers.slice(0, threshold);
const one = signers.slice(0, 1);

results.push(runCase("Case 1 — happy path ($10 swap, 2/2 sigs, 30 bps)",
  { op: baseOp, approvers: two, cfg: POLICY }, true));

results.push(runCase("Case 2 — below threshold (only 1 approver)",
  { op: baseOp, approvers: one, cfg: POLICY }, false));

results.push(runCase("Case 3 — quorum met, spend-cap violated ($9,999)",
  { op: { ...baseOp, amount: "9999", amountUsd: 9999 }, approvers: two, cfg: POLICY }, false));

results.push(runCase("Case 4 — quorum met, slippage 500 bps > 50 bps cap",
  { op: { ...baseOp, slippageBps: 500 }, approvers: two, cfg: POLICY }, false));

results.push(runCase("Case 5 — token 'DOGE' not in allowlist",
  { op: { ...baseOp, to: { symbol: "DOGE" } }, approvers: two, cfg: POLICY }, false));

results.push(runCase(`Case 6 — forged signature under ${two[0]}'s name`,
  { op: baseOp, approvers: two, cfg: POLICY, forgeFor: two[0] }, false));

clearPending();

const ok = results.filter(Boolean).length;
console.log("");
const line = `${ok}/${results.length} cases behaved as expected`;
if (ok === results.length) {
  console.log(`${C.g}${C.b}🟢 ${line}${C.x}`);
  console.log(`${C.d}Same check() contract the real CLI runs — only the OWS signer is short-circuited here.${C.x}`);
  process.exit(0);
}
console.log(`${C.r}${C.b}🔴 ${line}${C.x}`);
process.exit(1);
