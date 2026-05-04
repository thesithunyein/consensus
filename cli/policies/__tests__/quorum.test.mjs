/**
 * Unit tests for the Consensus quorum policy.
 * Run with:  node --test cli/policies/__tests__/*.test.mjs
 *
 * Uses a scratch state dir (CONSENSUS_STATE_DIR env) so the suite never
 * touches the developer's real ~/.consensus.
 */

import { test, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";

let tmp;
before(() => {
  tmp = mkdtempSync(join(tmpdir(), "consensus-test-"));
  process.env.CONSENSUS_STATE_DIR = tmp;
  mkdirSync(join(tmp, "pending"), { recursive: true });
});
after(() => rmSync(tmp, { recursive: true, force: true }));

beforeEach(() => {
  for (const f of readdirSync(join(tmp, "pending"))) {
    try { unlinkSync(join(tmp, "pending", f)); } catch { /* noop */ }
  }
  delete process.env.ZERION_CONSENSUS_NONCE;
});

async function loadPolicy() {
  return (await import(`../quorum.mjs?v=${Date.now()}${Math.random()}`)).check;
}

function writeMembers(members, threshold) {
  writeFileSync(join(tmp, "members.json"), JSON.stringify({ members, threshold }));
}

function keypair() {
  const kp = nacl.sign.keyPair();
  return {
    pubkey: naclUtil.encodeBase64(kp.publicKey),
    secret: kp.secretKey,
  };
}

function canonicalHashLike({ op, wallet, chain, from, to, amount, nonce }) {
  // Matches bot/proposals.mjs::canonicalHash shape (minus optional fields)
  const c = {
    op, wallet, chain,
    toChain: null,
    fromSymbol: from.toLowerCase(),
    toSymbol: to.toLowerCase(),
    amount: String(amount),
    amountUsd: null,
    slippageBps: null,
    destAddress: null,
    nonce,
  };
  const json = JSON.stringify(c, Object.keys(c).sort());
  return createHash("sha256").update(json).digest("hex");
}

function writeProposal(p) {
  writeFileSync(join(tmp, "pending", `${p.id}.json`), JSON.stringify(p));
}

/* -------------------------------- tests -------------------------------- */

test("opts out when policy_config.quorum is not set", async () => {
  const check = await loadPolicy();
  const r = check({ transaction: { to: "0xabc" }, policy_config: {} });
  assert.equal(r.allow, true);
});

test("fail-closed when members.json missing", async () => {
  try { unlinkSync(join(tmp, "members.json")); } catch {}
  process.env.ZERION_CONSENSUS_NONCE = "n1";
  const check = await loadPolicy();
  const r = check({ transaction: {}, policy_config: { quorum: true } });
  assert.equal(r.allow, false);
  assert.match(r.reason, /fail-closed/);
});

test("rejects when no ZERION_CONSENSUS_NONCE provided", async () => {
  writeMembers([{ name: "a", pubkey: keypair().pubkey }], 1);
  const check = await loadPolicy();
  const r = check({ transaction: {}, policy_config: { quorum: true } });
  assert.equal(r.allow, false);
  assert.match(r.reason, /ZERION_CONSENSUS_NONCE/);
});

test("accepts when threshold met with valid signatures", async () => {
  const alice = keypair(), bob = keypair(), carol = keypair();
  writeMembers(
    [
      { name: "alice", pubkey: alice.pubkey },
      { name: "bob",   pubkey: bob.pubkey },
      { name: "carol", pubkey: carol.pubkey },
    ],
    2,
  );
  const hash = canonicalHashLike({
    op: "swap", wallet: "treasury", chain: "base",
    from: "USDC", to: "ETH", amount: "10", nonce: "n42",
  });
  const sign = (sk) => naclUtil.encodeBase64(nacl.sign.detached(naclUtil.decodeUTF8(hash), sk));
  writeProposal({
    id: "p1", hash,
    op: { nonce: "n42" },
    expiresAt: Date.now() + 60_000,
    approvals: [
      { member: "alice", sig: sign(alice.secret) },
      { member: "bob",   sig: sign(bob.secret) },
    ],
  });

  process.env.ZERION_CONSENSUS_NONCE = "n42";
  const check = await loadPolicy();
  const r = check({ transaction: {}, policy_config: { quorum: true } });
  assert.equal(r.allow, true, r.reason);
});

test("rejects forged signature (wrong signer under alice's name)", async () => {
  const alice = keypair(), mallory = keypair();
  writeMembers([{ name: "alice", pubkey: alice.pubkey }], 1);
  const hash = canonicalHashLike({
    op: "swap", wallet: "t", chain: "base",
    from: "USDC", to: "ETH", amount: "5", nonce: "n7",
  });
  const forged = naclUtil.encodeBase64(nacl.sign.detached(naclUtil.decodeUTF8(hash), mallory.secret));
  writeProposal({
    id: "p2", hash,
    op: { nonce: "n7" },
    expiresAt: Date.now() + 60_000,
    approvals: [{ member: "alice", sig: forged }],
  });

  process.env.ZERION_CONSENSUS_NONCE = "n7";
  const check = await loadPolicy();
  const r = check({ transaction: {}, policy_config: { quorum: true } });
  assert.equal(r.allow, false);
  assert.match(r.reason, /0\/1 valid/);
});

test("rejects expired proposal", async () => {
  const a = keypair();
  writeMembers([{ name: "a", pubkey: a.pubkey }], 1);
  const hash = canonicalHashLike({
    op: "swap", wallet: "t", chain: "base",
    from: "USDC", to: "ETH", amount: "1", nonce: "nX",
  });
  writeProposal({
    id: "p3", hash,
    op: { nonce: "nX" },
    expiresAt: Date.now() - 1_000,
    approvals: [{ member: "a", sig: naclUtil.encodeBase64(nacl.sign.detached(naclUtil.decodeUTF8(hash), a.secret)) }],
  });

  process.env.ZERION_CONSENSUS_NONCE = "nX";
  const check = await loadPolicy();
  const r = check({ transaction: {}, policy_config: { quorum: true } });
  assert.equal(r.allow, false);
  assert.match(r.reason, /no non-expired proposal/);
});

test("reads nonce from current.nonce file when env missing", async () => {
  const a = keypair();
  writeMembers([{ name: "a", pubkey: a.pubkey }], 1);
  const hash = canonicalHashLike({
    op: "swap", wallet: "t", chain: "base",
    from: "USDC", to: "ETH", amount: "2", nonce: "file-nonce",
  });
  writeProposal({
    id: "p4", hash,
    op: { nonce: "file-nonce" },
    expiresAt: Date.now() + 60_000,
    approvals: [{ member: "a", sig: naclUtil.encodeBase64(nacl.sign.detached(naclUtil.decodeUTF8(hash), a.secret)) }],
  });
  writeFileSync(join(tmp, "current.nonce"), "file-nonce");

  const check = await loadPolicy();
  const r = check({ transaction: {}, policy_config: { quorum: true } });
  assert.equal(r.allow, true, r.reason);

  try { unlinkSync(join(tmp, "current.nonce")); } catch {}
});
