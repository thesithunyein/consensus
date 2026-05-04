# Consensus — Policy specification & threat model

All five Consensus policies implement the upstream contract:
```js
export function check(ctx) { return { allow: boolean, reason?: string }; }
```
They are selected per agent-token at `zerion agent create-policy` time (see `--quorum`, `--spend-cap-per-tx`, `--max-slippage-bps`, `--token-allowlist`, `--trading-hours`, `--weekdays-only` flags). All policies are **fail-closed**: on missing config, unreadable state, or malformed input, `check()` returns `{ allow: false, reason: "..." }`.

## 1. Quorum (`cli/policies/quorum.mjs`)

### Guarantee

A transaction is permitted only when, at policy-evaluation time:

1. `policy_config.quorum === true` (policy opt-in)
2. A nonce is available via either `process.env.ZERION_CONSENSUS_NONCE` or `<state_dir>/current.nonce` file
3. A pending proposal JSON under `<state_dir>/pending/` has `op.nonce` matching the active nonce and `expiresAt > now()`
4. The proposal carries ≥ `members.threshold` cryptographically valid Ed25519 signatures from registered members over the stored `proposal.hash`

### Canonical intent hash

Computed by `bot/proposals.mjs::canonicalHash` and stored in `proposal.hash`. Members sign this hash; `quorum.mjs` reads it verbatim from the proposal file and verifies each `{member, sig}` pair against `members.json`. The hash includes:

- `op`, `wallet`, `chain`, `toChain`
- `fromSymbol`, `toSymbol` (lowercased)
- `amount` (string), `amountUsd` (2dp), `slippageBps`
- `destAddress` (lowercased), `nonce`

Any drift between what the group agreed to and what the bot would actually execute breaks every signature → denial.

### Threat model

| Threat | Mitigation |
|---|---|
| Bot operator leaks / loses the Zerion agent API key | Attacker cannot forge member sigs; `quorum.mjs` denies every op lacking ≥ threshold valid signatures. |
| A single member key is compromised | Below threshold → no effect (that's the whole point of N-of-M). |
| Replay of a previously-executed proposal | Proposal file is moved out of `pending/` into `executed/` atomically after success. New nonces per proposal. |
| Parameter tampering between approval and execution | Canonical hash includes every value-affecting field. Any change breaks all sigs. |
| Missing or corrupt `members.json` | `loadMembers()` throws; policy returns `allow:false`. |
| Policy invoked without the bot (direct `zerion swap`) | No `ZERION_CONSENSUS_NONCE` env nor `current.nonce` file → explicit denial with message. |
| Stale `current.nonce` left over from crashed bot | Expiry on every proposal + bot clears the file on exit. Worst case: denied for "no non-expired proposal". |
| Duplicate signature from same member | `addApproval` in the bot rejects duplicates; policy de-dupes via `Set` when counting valid signers. |

### What it does **not** protect against

- A member *voluntarily* signing a malicious payload (social engineering). Only mitigation: members should read the proposal card before tapping Approve.
- Compromise of bot + ≥ threshold member devices simultaneously (game over by definition).

## 2. Spend cap (`spend-cap.mjs`)

Reads proposal `op.amountUsd`. Denies if `> spend_cap_per_tx_usd`. Sums `executed/*.json` entries within the last 24 h and denies if prior + this tx `> spend_cap_24h_usd`. Fail-closed when `amountUsd` is not provided.

## 3. Slippage ceiling (`slippage-ceiling.mjs`)

Reads proposal `op.slippageBps`. Denies if `> max_slippage_bps`. Fail-closed when missing.

## 4. Token allowlist (`token-allowlist.mjs`)

Per-chain `UPPER`-cased allowlist applied to both `from.symbol` and `to.symbol`. For bridges both source and destination chain lists are checked. Empty list for a chain means nothing tradeable (fail-closed by design).

## 5. Time window (`time-window.mjs`)

`trading_hours_utc: [start, end)` with wrap-around support. Optional `weekdays_only: true` blocks Sat/Sun. Opt-in.

## Composition

When `zerion agent create-policy --quorum --spend-cap-per-tx 500 …` is run, every enabled policy is appended to the policy's `config.scripts[]`. The upstream `run-policies.mjs` dispatcher runs them sequentially with AND semantics — any `allow:false` short-circuits to a deny. Ordering used in `create-policy.js`:

```
deny-transfers → deny-approvals → allowlist →
quorum → spend-cap → slippage-ceiling → token-allowlist → time-window
```

## Testing

`pnpm test:consensus` (alias for `node --test cli/policies/__tests__/*.test.mjs`). 7 cases today; spend-cap / slippage / allowlist / time-window follow the same scaffold for straightforward extension.
