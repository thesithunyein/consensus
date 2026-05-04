/**
 * signer.mjs — Ed25519 approval utilities.
 *
 * Two flows:
 *   (A) DEMO MODE — member DMs /register <name> <privkey_b64>. Key lives in
 *       bot process RAM only; cleared on restart. One-tap approvals.
 *   (B) OFFLINE MODE — member runs `node scripts/consensus/sign.mjs` on their
 *       own device, pastes back /approve_sig <id> <name> <sig_b64>. Keys
 *       never leave the device.
 *
 * Both flows are verified against members.json inside the quorum policy at
 * CLI policy-evaluation time, so neither can bypass enforcement.
 */

import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import { loadMembers } from "./config.mjs";

const DEMO_KEYS = new Map();   // tgUserId -> { memberName, secret }

export function registerDemoKey(tgUserId, memberName, privkeyB64) {
  const { members } = loadMembers();
  const member = members.find((m) => m.name === memberName);
  if (!member) throw new Error(`unknown member: ${memberName}`);
  const secret = naclUtil.decodeBase64(privkeyB64);
  if (secret.length !== nacl.sign.secretKeyLength) {
    throw new Error(`invalid Ed25519 secret length: ${secret.length}`);
  }
  const kp = nacl.sign.keyPair.fromSecretKey(secret);
  if (naclUtil.encodeBase64(kp.publicKey) !== member.pubkey) {
    throw new Error(`secret does not match pubkey registered for "${memberName}"`);
  }
  DEMO_KEYS.set(tgUserId, { memberName, secret });
  return member;
}

export function hasDemoKey(tgUserId) { return DEMO_KEYS.has(tgUserId); }

export function signDemo(tgUserId, hashHex) {
  const e = DEMO_KEYS.get(tgUserId);
  if (!e) throw new Error("no demo key registered; use /register in DM");
  return {
    member: e.memberName,
    sig: naclUtil.encodeBase64(nacl.sign.detached(naclUtil.decodeUTF8(hashHex), e.secret)),
  };
}

export function verifySig(memberName, hashHex, sigB64) {
  const { members } = loadMembers();
  const m = members.find((x) => x.name === memberName);
  if (!m) return false;
  try {
    return nacl.sign.detached.verify(
      naclUtil.decodeUTF8(hashHex),
      naclUtil.decodeBase64(sigB64),
      naclUtil.decodeBase64(m.pubkey),
    );
  } catch { return false; }
}
