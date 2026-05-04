#!/usr/bin/env node
/**
 * gen-member-keys.mjs — bootstrap the member set for Consensus.
 *
 * Usage:
 *   pnpm consensus:gen-keys alice bob carol --threshold 2
 *
 * Writes:
 *   ~/.consensus/members.json                       (pubkeys only)
 *   ~/.consensus/keys/<name>.privkey.b64            (SECRET — DM to member out-of-band)
 *   ~/.consensus/config.json                        (default policy config, edit after)
 *
 * Re-running with existing members.json refuses to overwrite. Use
 * `--force` to rotate (will invalidate all pending proposals).
 */

import { writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

const STATE_DIR = process.env.CONSENSUS_STATE_DIR || join(homedir(), '.consensus');

function parseArgs(argv) {
  const names = [];
  let threshold = null;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--threshold') threshold = Number(argv[++i]);
    else if (a === '--force') force = true;
    else if (a.startsWith('-')) { console.error(`unknown flag ${a}`); process.exit(1); }
    else names.push(a);
  }
  if (names.length < 2) {
    console.error('Provide ≥ 2 member names.  Example:\n  pnpm consensus:gen-keys alice bob carol --threshold 2');
    process.exit(1);
  }
  if (threshold == null || threshold < 1 || threshold > names.length) {
    console.error(`Provide --threshold between 1 and ${names.length}`);
    process.exit(1);
  }
  return { names, threshold, force };
}

const { names, threshold, force } = parseArgs(process.argv.slice(2));

for (const sub of ['', 'keys', 'pending', 'executed']) {
  const p = join(STATE_DIR, sub);
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

const membersPath = join(STATE_DIR, 'members.json');
if (existsSync(membersPath) && !force) {
  console.error(`refusing to overwrite ${membersPath} — pass --force to rotate`);
  process.exit(1);
}

const members = names.map((name) => {
  const kp = nacl.sign.keyPair();
  const pubkey = naclUtil.encodeBase64(kp.publicKey);
  const privkey = naclUtil.encodeBase64(kp.secretKey);
  const privPath = join(STATE_DIR, 'keys', `${name}.privkey.b64`);
  writeFileSync(privPath, privkey + '\n');
  try { chmodSync(privPath, 0o600); } catch {}
  return { name, pubkey, privPath };
});

writeFileSync(
  membersPath,
  JSON.stringify(
    { threshold, members: members.map(({ name, pubkey }) => ({ name, pubkey })) },
    null, 2,
  ),
);

console.log(`✅ wrote ${membersPath}`);
console.log('\n🔐 PRIVATE KEYS — DM each file to its member out-of-band, then delete the local copy:');
for (const m of members) console.log(`   ${m.name}  →  ${m.privPath}`);
console.log(`\nThreshold: ${threshold} / ${members.length}\n`);
console.log('Next step — create the agent policy that activates Consensus:\n');
console.log('  zerion agent create-policy --name treasury-consensus \\');
console.log('    --chains base --deny-approvals --expires 30d \\');
console.log('    --quorum \\');
console.log('    --spend-cap-per-tx 500 --spend-cap-24h 2000 \\');
console.log('    --max-slippage-bps 50 \\');
console.log('    --token-allowlist "base:USDC,ETH,WETH,cbBTC" \\');
console.log('    --trading-hours 13-22 --weekdays-only\n');
