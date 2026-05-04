# Consensus — Codespace runbook

Every command you need, in order, copy-paste-able. Each step is one line or one block.

## 0. Open Codespace

On `github.com/thesithunyein/consensus` click **`<> Code` → Codespaces → Create codespace on main**. Wait ~60 s for the devcontainer `postCreateCommand` to finish (`pnpm install` runs automatically).

## 1. Health check (should be mostly red at first)

```bash
pnpm consensus:doctor
```

Expected red items on first run: all 5 `env` vars, `members.json`. Everything else green.

## 2. Credentials (do these in parallel, 10 min total)

**Telegram bot** → message [@BotFather](https://t.me/BotFather):
```
/newbot
Consensus Treasury Bot
consensus_treasury_<anything>_bot
```
Copy the HTTP API token.

Then:
```
/setprivacy
<select your bot>
Disable
```

Add the bot to a new group called *Consensus Treasury*. In that group send `/chatid@your_bot` once it's running (step 6) — note the negative number.

**Zerion API key** → https://dashboard.zerion.io → sign up → **Create API key** → scope *developer*. Copy.

**Treasury wallet** (inside Codespace):
```bash
pnpm start wallet create --name consensus-treasury
pnpm start wallet fund --wallet consensus-treasury
```
Scan the QR with Zerion / Rainbow / Rabby and send ~$20 USDC on **Base**.

## 3. Generate member keys

```bash
pnpm consensus:gen-keys alice bob carol --threshold 2
```

It prints 3 privkey file paths. **Copy each file contents into a DM to that Telegram account**, then shred:
```bash
shred -u .consensus-local/keys/*.privkey.b64    # or: rm + srm
```

## 4. Create the agent policy (this is where Consensus activates)

```bash
pnpm start agent create-policy \
  --name treasury-consensus \
  --chains base \
  --deny-approvals \
  --expires 30d \
  --quorum \
  --spend-cap-per-tx 500 \
  --spend-cap-24h 2000 \
  --max-slippage-bps 50 \
  --token-allowlist "base:USDC,ETH,WETH,cbBTC" \
  --trading-hours 13-22 \
  --weekdays-only
```

Note the printed `policy-treasury-consensus-<8 hex>` id.

## 5. Mint the agent token

```bash
pnpm start agent create-token \
  --name treasury-bot \
  --wallet consensus-treasury \
  --policy policy-treasury-consensus-xxxxxxxx
```

Copy the printed token.

## 6. Wire .env and start

```bash
cp .env.consensus.example .env
# edit: TELEGRAM_BOT_TOKEN, TELEGRAM_GROUP_CHAT_ID, ZERION_API_KEY,
#       ZERION_AGENT_TOKEN, ZERION_WALLET=consensus-treasury
pnpm consensus:doctor          # should now be all green
pnpm consensus:bot
```

In the Telegram group:
```
/chatid                                           (note and fill into .env, restart)
/members                                          (confirm 3 members, threshold 2)
```

## 7. Smoke test — real $2 swap

```
/propose swap USDC ETH 2 --chain base --amount-usd 2 --slippage-bps 30
```

Each of the 3 Telegram accounts:
- DM the bot: `/register alice <privkey-b64>` (etc)
- Tap **Approve** in the group

After 2 approvals → watch the bot execute. Expected:
```
🟢 Executed p<id>
Tx: 0x…
https://basescan.org/tx/0x…
```

## 8. Policy denial test (optional but great for demo)

```
/propose swap USDC ETH 9999 --chain base --amount-usd 9999
```

Approve twice. Expected:
```
🔴 Execution blocked
Policy denied: spend-cap: $9999.00 exceeds per-tx cap $500
```

## 9. Export executed txs for the submission form

```bash
pnpm consensus:list-executed > executed.md
cat executed.md
```

Paste into the Superteam Earn submission and into `docs-consensus/SUBMISSION.md`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `pnpm consensus:doctor` says "zerion CLI: exit N" | Run `pnpm install` again; make sure `./cli/zerion.js` exists. |
| Bot says "members.json missing" | Re-run step 3. |
| Every swap denied with "quorum: no ZERION_CONSENSUS_NONCE" | You're invoking `zerion swap` by hand — that's the policy working correctly. Only the bot should spawn `zerion`. |
| Bot's `zerion` subprocess exits non-zero with no tx hash | Check `pnpm consensus:doctor` + agent token is actually bound to this policy (`pnpm start agent list-tokens`). |
| Every swap denied with "quorum: 0/2 valid signatures" | `/register` mapping is wrong — member's private key doesn't match the pubkey in members.json. Re-gen keys and re-DM. |
