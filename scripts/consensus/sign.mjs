#!/usr/bin/env node
/**
 * sign.mjs — offline signing for members who don't want to hand a key to the bot.
 *
 * Usage on the member's own device:
 *   node scripts/sign.mjs <proposal-hash> <path-to-privkey-file>
 *   # or
 *   CONSENSUS_PRIVKEY=<b64> node scripts/sign.mjs <proposal-hash>
 *
 * Prints a base64 signature. Paste back into the group chat as:
 *   /approve_sig <proposal-id> <your-member-name> <signature>
 */

import { readFileSync } from 'node:fs';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

const [, , hash, keyPath] = process.argv;
if (!hash) {
  console.error('usage: node scripts/sign.mjs <proposal-hash> [<privkey-file>]');
  process.exit(1);
}

const privB64 = keyPath
  ? readFileSync(keyPath, 'utf8').trim()
  : process.env.CONSENSUS_PRIVKEY?.trim();
if (!privB64) {
  console.error('no key — pass a path or set CONSENSUS_PRIVKEY');
  process.exit(1);
}

const secret = naclUtil.decodeBase64(privB64);
const sig = nacl.sign.detached(naclUtil.decodeUTF8(hash), secret);
console.log(naclUtil.encodeBase64(sig));
