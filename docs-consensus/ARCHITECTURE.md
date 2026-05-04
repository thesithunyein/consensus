# Architecture

```
┌──── Telegram group ───────────────────────────────────┐
│                                                        │
│  alice  /propose swap USDC ETH 10 --chain base         │
│                --amount-usd 10 --slippage-bps 30       │
│                                                        │
│  ┌────── Proposal card ──────┐                         │
│  │ id: p7f3a2                 │                        │
│  │ SWAP 10 USDC → ETH on base │  [✅ Approve] [❌]     │
│  │ hash: 8b7c…                │                        │
│  │ quorum: 0/2 of 3 · 58m     │                        │
│  └───────────────────────────┘                         │
└─────────────────────┬──────────────────────────────────┘
                      │ bot writes / updates
                      ▼
              ~/.consensus/
              ├── members.json         (pubkeys + threshold)
              ├── pending/<id>.json    (proposal + approvals[])
              ├── executed/<id>.json   (+ txHash, amountUsd, ts)
              └── current.nonce        (live nonce channel to CLI)

                      ▲
                      │ 5 Consensus policies read by-nonce
                      │
┌──── Forked zerion CLI ────────────────────────────────┐
│  bot spawns  zerion swap ...  with                     │
│    env ZERION_CONSENSUS_NONCE=<nonce>                  │
│    (and ~/.consensus/current.nonce as fallback)        │
│                                                         │
│  cli/policies/run-policies.mjs  (AND semantics)        │
│    ├─ quorum.mjs                                        │
│    ├─ spend-cap.mjs                                     │
│    ├─ slippage-ceiling.mjs                              │
│    ├─ token-allowlist.mjs                               │
│    ├─ time-window.mjs                                   │
│    └─ upstream: allowlist / deny-transfers / deny-approvals
│                                                         │
│  signer → Zerion API → Base mainnet                    │
└─────────────────────┬──────────────────────────────────┘
                      ▼
                 real tx hash → bot posts to group
```

## Components

**`bot/`** — Telegraf bot. Proposal state lives on-disk at `~/.consensus/`, so restarting the bot loses no approvals. The only in-memory state is the `DEMO_KEYS` map in `signer.mjs`, deliberately volatile — members re-register after a restart, or use offline signing where keys never touch the bot.

**`cli/policies/*.mjs`** — five independent fail-closed modules matching the upstream `check(ctx) -> {allow, reason}` contract. No inter-module dependencies. All read configuration from `ctx.policy_config` (set once at `zerion agent create-policy` time); the only runtime channel is the proposal nonce via env or file.

**`cli/commands/agent/create-policy.js`** — extended upstream command that recognises 7 new Consensus flags and writes them into `policy_config`. No upstream flag semantics changed.

**`scripts/consensus/`**
- `gen-member-keys.mjs` — creates Ed25519 keypairs for each member and writes `members.json`.
- `sign.mjs` — offline signer for members who don't want to hand their key to the bot.

## Trust boundaries

| Boundary | Trust assumption |
|---|---|
| Bot operator ↔ members | Operator **cannot** act as any member (members hold private keys; only the bot operator has the API key). |
| Bot process ↔ CLI policy engine | Policy engine runs inside the `zerion` subprocess; bot only passes a nonce. Nothing in ctx is operator-controllable except that nonce value, which must point to a signed proposal. |
| Forked CLI ↔ Zerion API | Unchanged from upstream — Zerion's existing OWS + agent-token model. |

## Why file-backed state instead of a DB

- Zero setup in a fresh Codespace; trivially auditable (`cat ~/.consensus/pending/*.json`).
- Fits the track's "keep it forkable" ethos.
- File-per-proposal avoids write contention; single-process bot anyway.

Swap for Postgres when you need multi-region HA; the data model is 1:1.
