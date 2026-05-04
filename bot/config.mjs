import "dotenv/config";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const STATE_DIR =
  process.env.CONSENSUS_STATE_DIR || join(homedir(), ".consensus");

for (const sub of ["", "pending", "executed", "keys"]) {
  const p = join(STATE_DIR, sub);
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

export function loadMembers() {
  const p = join(STATE_DIR, "members.json");
  if (!existsSync(p)) {
    throw new Error(`members.json missing — run  pnpm consensus:gen-keys  first`);
  }
  return JSON.parse(readFileSync(p, "utf8"));
}

function required(k) {
  const v = process.env[k];
  if (!v) {
    console.error(`Missing required env var: ${k}`);
    process.exit(1);
  }
  return v;
}

export const CFG = {
  tgToken: required("TELEGRAM_BOT_TOKEN"),
  groupChatId: Number(required("TELEGRAM_GROUP_CHAT_ID")),
  zerionApiKey: required("ZERION_API_KEY"),
  zerionAgentToken: required("ZERION_AGENT_TOKEN"),
  zerionWallet: required("ZERION_WALLET"),
  zerionPassphrase: process.env.ZERION_WALLET_PASSPHRASE ?? "",
  defaultSlippageBps: Number(process.env.CONSENSUS_DEFAULT_SLIPPAGE_BPS || 50),
  proposalTtlSec: Number(process.env.CONSENSUS_PROPOSAL_TTL || 3600),
  stateDir: STATE_DIR,
};
