# Consensus — 3-minute demo script

Target: 2 min 45 s. Single take preferred. Screen-share with webcam PiP.

## Setup (off-camera, before recording)

- Codespace running; bot started with `pnpm consensus:bot`.
- Three Telegram accounts (`alice`, `bob`, `carol`) in the group *Consensus Treasury*.
- Treasury wallet funded with ~$30 USDC on Base mainnet.
- `~/.consensus/members.json` with `threshold: 2`.
- Agent policy `treasury-consensus` created with `--quorum --spend-cap-per-tx 500 --max-slippage-bps 50 --token-allowlist "base:USDC,ETH,WETH"` …

## Script

**[0:00 – 0:15]** *Hook*.
> "Every autonomous trading agent the judges have seen this week is god-mode — one API key, total control. Consensus breaks that. No single entity, not even me, can move funds from this wallet. Let me show you."

Cut to terminal: `cat ~/.consensus/members.json` (threshold 2 of 3, pubkeys listed).

**[0:15 – 0:40]** *The group agrees on a trade.*

In Telegram, as alice:
```
/propose swap USDC ETH 10 --chain base --amount-usd 10 --slippage-bps 30
```

Bot replies with the proposal card + Approve / Reject buttons. Zoom in on the *Hash* field:
> "Every field of that trade — tokens, amounts, slippage, chain — is committed to this hash. Members sign exactly this."

**[0:40 – 1:10]** *Sabotage attempt.*

Switch to the terminal and try to bypass the bot:
```
zerion swap USDC ETH 10 --chain base --wallet consensus-treasury
```

CLI exits non-zero:
```
Policy denied: quorum: no ZERION_CONSENSUS_NONCE env or current.nonce file.
This transaction must be executed via the Consensus bot, not by hand.
```

> "The quorum policy runs *inside* the CLI, not the bot. Bypassing the bot doesn't bypass the policy."

**[1:10 – 1:55]** *Two members approve.*

alice taps Approve → bot posts `✅ alice approved — 1/2`.
bob  taps Approve → bot posts `✅ bob approved — 2/2`, then `🎯 Quorum reached, executing via Zerion CLI…`.

Bot posts the execution result:
```
🟢 Executed p7f3a2
Tx: 0x8b7c…a1f2
https://basescan.org/tx/0x8b7c…a1f2
```

Click the basescan link on-screen. A real Base mainnet USDC→ETH swap.

**[1:55 – 2:30]** *Layered policies in action.*

As carol:
```
/propose swap USDC ETH 10000 --chain base --amount-usd 10000
```

alice + bob approve, quorum met. Bot executes — and the `spend-cap` policy rejects:
```
🔴 Execution blocked
Policy denied: spend-cap: $10000.00 exceeds per-tx cap $500
```

> "Even with full quorum, the $500 per-tx cap fired. Policies compose. None of them can be disabled without re-creating the agent token — so the operator can't relax them mid-demo."

**[2:30 – 2:45]** *Close.*

> "Five fail-closed policies, cryptographic N-of-M consensus, real Base mainnet swaps routed through the Zerion API — exactly what the track asks for. Fork of zeriontech/zerion-ai, MIT, repo at github.com/thesithunyein/consensus."

## Tx hashes to paste into the submission

Capture 2–3 real tx hashes during the demo (successful swap + blocked $10k attempt log + one bridge if time permits). Pin them in the group chat and paste them into the Superteam Earn submission form.

## Reproducibility for judges

```bash
gh repo clone thesithunyein/consensus && cd consensus
pnpm install
pnpm consensus:gen-keys judge1 judge2 --threshold 2
# configure .env, mint agent policy + token, fund a wallet on Base
pnpm consensus:bot
# in a test group chat, run the same /propose flow
```
