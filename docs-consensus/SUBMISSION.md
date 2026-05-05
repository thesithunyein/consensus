# Consensus — Superteam Earn submission copy

Paste into the Submit form on the *Build an Autonomous Onchain Agent using Zerion CLI* listing.

---

## Project name

**Consensus**

## One-line pitch

Cryptographic N-of-M multi-sig trading agent built on the Zerion CLI policy engine — the first submission where the bot operator cannot execute trades alone.

## Repository

https://github.com/thesithunyein/consensus (fork of [`zeriontech/zerion-ai`](https://github.com/zeriontech/zerion-ai))

Start here: [CONSENSUS.md](https://github.com/thesithunyein/consensus/blob/main/CONSENSUS.md)

## Demo video

**▶ https://youtu.be/Cn0YWXk53RA**

## What I built

Consensus turns the Zerion CLI into a **shared-custody trading terminal** for DAO treasuries, trading collectives, and family offices.

Every swap, bridge, and transfer requires **M Ed25519 signatures** from a configured member set, verified cryptographically **inside the CLI's policy engine** before OWS signs anything. If the bot operator's agent token leaks, the attacker cannot forge signatures — no funds move.

### New policies (all implement the upstream `check(ctx) -> {allow, reason}` contract, all fail-closed)

1. **quorum.mjs** — requires ≥ threshold valid Ed25519 signatures over a canonical intent hash, with nonce + expiry anti-replay.
2. **spend-cap.mjs** — per-tx USD ceiling + rolling 24h aggregate from the local executed-ledger.
3. **slippage-ceiling.mjs** — denies quotes above a bps ceiling.
4. **token-allowlist.mjs** — per-chain symbol allowlist; empty list means no trading on that chain (fail-closed).
5. **time-window.mjs** — UTC trading hours + optional weekdays-only.

### Upstream integration

I extended `cli/commands/agent/create-policy.js` with seven new flags (`--quorum`, `--spend-cap-per-tx`, `--spend-cap-24h`, `--max-slippage-bps`, `--token-allowlist`, `--trading-hours`, `--weekdays-only`) that wire the new policies into `policy_config.scripts[]` using the existing dispatcher contract — zero upstream semantics changed.

### Interface

A Telegraf Telegram bot in `bot/` that:
- accepts `/propose swap|bridge|send …` in a configured group chat
- shows inline Approve / Reject buttons
- supports **offline signing** (`node scripts/consensus/sign.mjs`) so member keys never leave their devices
- shells out to the forked `zerion` CLI after quorum is reached, passing the proposal nonce via env + file
- posts the real tx hash + Basescan link back to the group

### Policy scope (example deployment)

```
zerion agent create-policy --name treasury-consensus \
  --chains base --deny-approvals --expires 30d \
  --quorum \
  --spend-cap-per-tx 500 --spend-cap-24h 2000 \
  --max-slippage-bps 50 \
  --token-allowlist "base:USDC,ETH,WETH,cbBTC" \
  --trading-hours 13-22 --weekdays-only
```

## How it satisfies each judging criterion

- **Onchain functionality** — confirmed live swap on Base mainnet, routed through Zerion API via ParaSwap: **[`0x7c4f...e8b0`](https://basescan.org/tx/0x7c4f85cc8955011f3944b6f362eb0660f4a8abcf81fd52c4045f0eea72d8e8b0)** (0.001 ETH → 2.334112 USDC, block 45568479). Basescan's own Transaction Action labels the trade as *"Swap on Zerion"* — third-party confirmation of the routing. ![Basescan proof](./assets/basescan-proof.jpg) The agent token executing this swap is bound to a `deny-transfers + 30d expiry` policy — no human intervention at sign time. Six additional adversarial scenarios (forged Ed25519 signatures, spend-cap violations, etc.) are exercised in `pnpm consensus:demo` against the identical `check(ctx)` function the CLI uses at runtime.

- **Policy design** — five fail-closed policies composed by upstream `run-policies.mjs`. The `quorum` policy is the structural answer to *"Are there any god-mode agents?"* — the operator cannot act without ≥ threshold member signatures, verified at the CLI layer, not the bot layer. Forging a signature, dropping below threshold, exceeding spend or slippage caps, trading an un-allowlisted token, or operating outside the trading window all produce a hard deny with a human-readable reason. See [POLICY-SPEC.md](./POLICY-SPEC.md) for the full threat model.

- **No god-mode agents** — this is the headline claim. If my agent token leaks tomorrow, the attacker still can't move funds, because forging three Ed25519 signatures from three independent devices is infeasible. No other submission in this track can say that.

- **Real-world applicability** — DAO treasuries, trading collectives, family offices, fund-of-funds. Safe{Wallet} solves the multi-sig primitive but doesn't route through Zerion and doesn't reach Solana cleanly. Consensus is the Zerion-native answer and pairs naturally with the existing `--chains`, `--expires`, `--deny-transfers`, `--deny-approvals` guards.

- **Code quality** — 100 % ESM, additive changes only, policies ≤ 150 LOC each, zero upstream breakage. `pnpm test:consensus` green (7/7). `pnpm consensus:demo` green (6/6). Additive diff only — every upstream test still passes.

- **Demo quality** — single-take 2:12 video shows the test suite + the six-case end-to-end demo + the architecture doc. Script at [RECORDING-SCRIPT.md](./RECORDING-SCRIPT.md).

## Tech stack

Node 20, Telegraf 4.16, tweetnacl Ed25519, existing Zerion CLI + OWS + Zerion API + Base mainnet.

## Team

Solo — [@thesithunyein](https://github.com/thesithunyein)
