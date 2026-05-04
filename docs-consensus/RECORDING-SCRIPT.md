# Recording script — 2 min 45 s submission video

Target length: **2:45**. One take. Screen capture with voice-over, no cut edits needed. Use Windows *Game Bar* (`Win+G`), OBS, or Loom.

## Pre-flight checklist (1 min before recording)

```powershell
# Windows PowerShell
wsl -d Ubuntu
```
Inside WSL:
```bash
cd ~/consensus
clear
```

Open a second editor tab on `CONSENSUS.md` so you can alt-tab to show it scrolling.

## The script (read verbatim, aim for conversational pace)

### [0:00 – 0:15] Hook

> "Hi. This is **Consensus**, my submission to the Frontier × Zerion autonomous-agent hackathon.
> Every other submission this week has the same structural flaw — one API key, total wallet control. Consensus breaks that. **No single operator can move funds, including me.**"

*On screen: title card or `CONSENSUS.md` scrolling past the hero paragraph.*

### [0:15 – 0:45] What it is

> "Consensus is a fork of `zeriontech/zerion-ai`. It adds five fail-closed policies to the existing Zerion CLI policy dispatcher — the headline one is a cryptographic **N-of-M Ed25519 quorum** gate. And it adds seven new flags to `zerion agent create-policy` so the whole stack is one command away."

*On screen: `ls cli/policies/` showing the five new files alongside the stock three.*

```bash
ls cli/policies/
```

### [0:45 – 1:25] Unit tests — fail-closed behaviour

> "The policy engine has seven unit tests covering forged signatures, expired proposals, missing configs, and both the env and file nonce channels."

```bash
pnpm test:consensus
```

*Wait for 7/7 pass to render.*

### [1:25 – 2:25] End-to-end demo — the money shot

> "And this is the end-to-end demo. It drives the exact same `check` function the real CLI calls at runtime, with six realistic cases."

```bash
pnpm consensus:demo
```

As each case prints, narrate:

> "Case 1 — happy path, allowed. Two of three, good signatures.
> Case 2 — only one approver, quorum denies.
> Case 3 — quorum passes but the ten-thousand-dollar amount trips the spend cap.
> Case 4 — slippage too high, slippage-ceiling blocks it even with full quorum.
> Case 5 — unknown token, token-allowlist denies.
> Case 6 — this is the important one — a **forged signature** under Alice's name. The quorum policy rejects it. That's the whole security claim, demonstrated in one line."

*Wait for `🟢 6/6 cases behaved as expected` to land.*

### [2:25 – 2:45] Close

> "Real-world applicability: DAO treasuries, trading collectives, family offices. Code, threat model, and the live-mainnet runbook are at **github.com/thesithunyein/consensus**. Fork, star, submit. Thanks."

*On screen: scroll `CONSENSUS.md` briefly, end on the GitHub URL.*

## Upload checklist

1. Export 1080p60 MP4.
2. Upload to **YouTube → unlisted** (not private). Get the share URL.
3. Paste URL into `docs-consensus/SUBMISSION.md` top section.
4. Submit the form on Superteam Earn, pasting `docs-consensus/SUBMISSION.md` content verbatim.
5. Pin the repo tweet or X post linking to the video.

## Tips

- Record with **two monitors** if possible — script on monitor 2, terminal on monitor 1.
- Speak ~170 wpm. The script above is ~430 words, fits comfortably in 2:45.
- Don't edit. One take is more authentic and faster.
- If a `pnpm` warning prints, don't address it on camera — it's cosmetic.
