/**
 * zerion.mjs — shells out to the forked Zerion CLI after quorum is reached.
 *
 * Communicates the active proposal's nonce to the policy engine via:
 *   1. process env ZERION_CONSENSUS_NONCE (preferred; inherited by child)
 *   2. <state_dir>/current.nonce file (fallback, in case OWS strips env)
 *
 * The file is written atomically before spawn and cleared after exit.
 */

import { spawn } from "node:child_process";
import { writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { CFG, STATE_DIR } from "./config.mjs";

const NONCE_FILE = join(STATE_DIR, "current.nonce");

function setNonce(nonce) {
  writeFileSync(NONCE_FILE, nonce, { mode: 0o600 });
}
function clearNonce() {
  try { if (existsSync(NONCE_FILE)) unlinkSync(NONCE_FILE); } catch { /* ignore */ }
}

function runZerion(args, nonce) {
  return new Promise((resolve) => {
    setNonce(nonce);
    const env = {
      ...process.env,
      ZERION_API_KEY: CFG.zerionApiKey,
      ZERION_AGENT_TOKEN: CFG.zerionAgentToken,
      ZERION_CONSENSUS_NONCE: nonce,
      ZERION_WALLET_PASSPHRASE: CFG.zerionPassphrase,
    };
    const p = spawn("zerion", args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => { clearNonce(); resolve(parseResult({ code, out, err })); });
    p.on("error", (e)   => { clearNonce(); resolve({ ok: false, code: -1, stderr: String(e), stdout: out }); });
  });
}

function parseResult({ code, out, err }) {
  let parsed = null, txHash = null;
  try {
    parsed = JSON.parse(out);
    txHash = parsed.tx_hash ?? parsed.hash ?? parsed.transaction?.hash ?? null;
  } catch { /* non-json output */ }
  return { ok: code === 0 && !!txHash, code, txHash, stdout: out, stderr: err, parsed };
}

export function executeSwap(op, nonce) {
  const args = [
    "swap", op.from.symbol, op.to.symbol, String(op.amount),
    "--chain", op.chain,
    "--wallet", CFG.zerionWallet,
    "--slippage-bps", String(op.slippageBps ?? CFG.defaultSlippageBps),
    "--json",
  ];
  return runZerion(args, nonce);
}

export function executeBridge(op, nonce) {
  const args = [
    "bridge", op.from.symbol, op.toChain, String(op.amount),
    "--chain", op.chain,
    "--to-token", op.to.symbol,
    "--wallet", CFG.zerionWallet,
    "--slippage-bps", String(op.slippageBps ?? CFG.defaultSlippageBps),
    "--json",
  ];
  return runZerion(args, nonce);
}

export function executeSend(op, nonce) {
  const args = [
    "send", op.from.symbol, String(op.amount),
    "--to", op.destAddress,
    "--chain", op.chain,
    "--wallet", CFG.zerionWallet,
    "--json",
  ];
  return runZerion(args, nonce);
}
