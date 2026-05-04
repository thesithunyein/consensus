import { Markup } from "telegraf";
import { CFG, loadMembers } from "./config.mjs";
import {
  createProposal, loadProposal, saveProposal, markExecuted,
  listPending, listExecuted,
} from "./proposals.mjs";
import {
  registerDemoKey, signDemo, hasDemoKey, verifySig,
} from "./signer.mjs";
import { executeSwap, executeBridge, executeSend } from "./zerion.mjs";

/* --------------------------- wire handlers --------------------------- */

export function registerHandlers(bot) {
  bot.command("start", (ctx) =>
    ctx.reply(
      "Consensus — N-of-M multi-sig trading on Zerion CLI.\n\n" +
      "DM me /register <your-name> <privkey-b64> for one-tap approvals (demo mode).\n" +
      "In the group, try:\n" +
      "  /propose swap USDC ETH 10 --chain base --amount-usd 10 --slippage-bps 30",
    ));

  bot.command("chatid", (ctx) => ctx.reply(`chat id: \`${ctx.chat.id}\``, { parse_mode: "Markdown" }));
  bot.command("members", onMembers);
  bot.command("propose", onPropose);
  bot.command("status", onStatus);
  bot.command("executed", onExecuted);
  bot.command("register", onRegister);
  bot.command("approve_sig", onApproveSig);

  bot.action(/^approve:(.+)$/, onApproveButton);
  bot.action(/^reject:(.+)$/,  onRejectButton);
}

/* ------------------------------- /members ---------------------------- */

function onMembers(ctx) {
  const { members, threshold } = loadMembers();
  ctx.reply(
    `*Members (${members.length}), threshold ${threshold}*\n` +
    members.map((m) => `• \`${m.name}\` — \`${m.pubkey.slice(0, 12)}…\``).join("\n"),
    { parse_mode: "Markdown" },
  );
}

/* ------------------------------- /propose ---------------------------- */

function parseProposeArgs(text) {
  const parts = text.trim().split(/\s+/).slice(1);
  const [kind, ...rest] = parts;
  const flags = {};
  const pos = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) { flags[rest[i].slice(2)] = rest[i + 1]; i++; }
    else pos.push(rest[i]);
  }
  return { kind, pos, flags };
}

async function onPropose(ctx) {
  if (ctx.chat.id !== CFG.groupChatId) {
    return ctx.reply("/propose only allowed in the configured group chat.");
  }
  const { kind, pos, flags } = parseProposeArgs(ctx.message.text);

  let op;
  try {
    const common = {
      slippageBps: flags["slippage-bps"] != null ? Number(flags["slippage-bps"]) : CFG.defaultSlippageBps,
      amountUsd:   flags["amount-usd"]   != null ? Number(flags["amount-usd"])   : null,
    };
    if (kind === "swap") {
      const [fromSym, toSym, amount] = pos;
      if (!fromSym || !toSym || !amount || !flags.chain)
        throw new Error("usage: /propose swap <FROM> <TO> <AMOUNT> --chain <c> [--amount-usd <n>] [--slippage-bps <n>]");
      op = { op: "swap", wallet: CFG.zerionWallet, chain: flags.chain,
             from: { symbol: fromSym }, to: { symbol: toSym }, amount, ...common };
    } else if (kind === "bridge") {
      const [fromSym, toChain, amount] = pos;
      if (!fromSym || !toChain || !amount || !flags.chain)
        throw new Error("usage: /propose bridge <FROM> <TO_CHAIN> <AMOUNT> --chain <c> [--to-token <T>]");
      op = { op: "bridge", wallet: CFG.zerionWallet, chain: flags.chain, toChain,
             from: { symbol: fromSym }, to: { symbol: flags["to-token"] ?? fromSym }, amount, ...common };
    } else if (kind === "send") {
      const [fromSym, amount] = pos;
      if (!fromSym || !amount || !flags.chain || !flags.to)
        throw new Error("usage: /propose send <TOKEN> <AMOUNT> --to <addr> --chain <c>");
      op = { op: "send", wallet: CFG.zerionWallet, chain: flags.chain, destAddress: flags.to,
             from: { symbol: fromSym }, amount, ...common };
    } else {
      throw new Error("unknown proposal kind; use swap | bridge | send");
    }
  } catch (e) { return ctx.reply(`❌ ${e.message}`); }

  const proposer = ctx.from.username ?? String(ctx.from.id);
  const proposal = createProposal({ op, ttlSec: CFG.proposalTtlSec, proposedBy: proposer });
  const { threshold, members } = loadMembers();

  return ctx.reply(
    formatProposal(proposal, threshold, members.length),
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        Markup.button.callback("✅ Approve", `approve:${proposal.id}`),
        Markup.button.callback("❌ Reject",  `reject:${proposal.id}`),
      ]),
    },
  );
}

function formatProposal(p, threshold, nMembers) {
  const o = p.op;
  const human =
    o.op === "swap"   ? `SWAP ${o.amount} ${o.from.symbol} → ${o.to.symbol} on *${o.chain}*` :
    o.op === "bridge" ? `BRIDGE ${o.amount} ${o.from.symbol} from *${o.chain}* → *${o.toChain}* (${o.to.symbol})` :
                        `SEND ${o.amount} ${o.from.symbol} → \`${o.destAddress}\` on *${o.chain}*`;
  const expiresIn = Math.max(0, Math.round((p.expiresAt - Date.now()) / 60000));
  const meta = [];
  if (o.amountUsd   != null) meta.push(`$${Number(o.amountUsd).toFixed(2)}`);
  if (o.slippageBps != null) meta.push(`slip ${o.slippageBps}bps`);
  return (
    `📝 *Proposal* \`${p.id}\` — by @${p.proposedBy}\n` +
    `${human}${meta.length ? ` _(${meta.join(" · ")})_` : ""}\n` +
    `Hash: \`${p.hash.slice(0, 16)}…\`\n` +
    `Quorum: ${p.approvals.length}/${threshold} of ${nMembers}  •  expires in ${expiresIn}m`
  );
}

/* --------------------------- approve / reject ------------------------ */

async function onApproveButton(ctx) {
  const id = ctx.match[1];
  const proposal = loadProposal(id);
  if (!proposal) return ctx.answerCbQuery("proposal not found or expired", { show_alert: true });
  if (proposal.expiresAt < Date.now()) return ctx.answerCbQuery("expired", { show_alert: true });

  if (!hasDemoKey(ctx.from.id)) {
    await ctx.answerCbQuery();
    return ctx.telegram.sendMessage(
      ctx.from.id,
      `To approve \`${id}\` with one tap, DM me first:\n` +
      `/register <your-member-name> <privkey-b64>\n\n` +
      `Or sign offline and reply in the group:\n` +
      `  node scripts/consensus/sign.mjs ${proposal.hash}\n` +
      `  /approve_sig ${id} <your-name> <sig-b64>`,
      { parse_mode: "Markdown" },
    ).catch(() => ctx.reply("DM me first to register your signing key."));
  }

  let approval;
  try { approval = signDemo(ctx.from.id, proposal.hash); }
  catch (e) { return ctx.answerCbQuery(e.message, { show_alert: true }); }
  return addApproval(ctx, proposal, approval);
}

async function onApproveSig(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/).slice(1);
  const [id, memberName, sigB64] = parts;
  if (!id || !memberName || !sigB64)
    return ctx.reply("usage: /approve_sig <proposal-id> <member-name> <sig-b64>");
  const proposal = loadProposal(id);
  if (!proposal) return ctx.reply("proposal not found");
  if (!verifySig(memberName, proposal.hash, sigB64))
    return ctx.reply("❌ signature failed verification");
  return addApproval(ctx, proposal, { member: memberName, sig: sigB64 });
}

async function addApproval(ctx, proposal, approval) {
  if (proposal.approvals.some((a) => a.member === approval.member)) {
    const msg = `already approved by ${approval.member}`;
    return ctx.answerCbQuery?.(msg) ?? ctx.reply(msg);
  }
  proposal.approvals.push(approval);
  saveProposal(proposal);
  const { threshold } = loadMembers();

  await ctx.telegram.sendMessage(CFG.groupChatId,
    `✅ \`${approval.member}\` approved \`${proposal.id}\` — ${proposal.approvals.length}/${threshold}`,
    { parse_mode: "Markdown" });
  ctx.answerCbQuery?.("approval recorded");

  if (proposal.approvals.length >= threshold) {
    await ctx.telegram.sendMessage(CFG.groupChatId,
      `🎯 Quorum reached on \`${proposal.id}\` — executing via Zerion CLI…`,
      { parse_mode: "Markdown" });
    try {
      const res = await executeOnchain(proposal);
      const final = markExecuted(proposal, res);
      if (res.ok) {
        await ctx.telegram.sendMessage(CFG.groupChatId,
          `🟢 *Executed* \`${final.id}\`\nTx: \`${res.txHash}\`\n${explorerUrl(final.op.chain, res.txHash)}`,
          { parse_mode: "Markdown", disable_web_page_preview: false });
      } else {
        await ctx.telegram.sendMessage(CFG.groupChatId,
          `🔴 *Execution blocked*\n\`\`\`\n${(res.stderr || res.stdout || `exit ${res.code}`).slice(0, 800)}\n\`\`\``,
          { parse_mode: "Markdown" });
      }
    } catch (e) {
      await ctx.telegram.sendMessage(CFG.groupChatId, `🔴 execution error: ${e.message}`);
    }
  }
}

async function onRejectButton(ctx) {
  const id = ctx.match[1];
  const p = loadProposal(id);
  if (!p) return ctx.answerCbQuery("not found", { show_alert: true });
  const name = ctx.from.username ?? String(ctx.from.id);
  if (!p.rejections.includes(name)) p.rejections.push(name);
  saveProposal(p);
  await ctx.answerCbQuery("rejection noted");
  return ctx.telegram.sendMessage(CFG.groupChatId,
    `❌ @${name} rejected \`${id}\` (informational; quorum policy is still the gate)`,
    { parse_mode: "Markdown" });
}

/* ------------------------------ /register ---------------------------- */

async function onRegister(ctx) {
  if (ctx.chat.type !== "private")
    return ctx.reply("❗ DM only. Never paste a private key in the group.");
  const [, memberName, privkey] = ctx.message.text.trim().split(/\s+/);
  if (!memberName || !privkey) return ctx.reply("usage: /register <member-name> <privkey-b64>");
  try {
    const m = registerDemoKey(ctx.from.id, memberName, privkey);
    return ctx.reply(
      `✅ registered as \`${m.name}\` for this session.\n\n` +
      `⚠️ Demo-mode: key lives in bot RAM only, cleared on restart. ` +
      `For production use \`node scripts/consensus/sign.mjs\` offline.`,
      { parse_mode: "Markdown" },
    );
  } catch (e) { return ctx.reply(`❌ ${e.message}`); }
}

/* --------------------------- status / executed ----------------------- */

async function onStatus(ctx) {
  const pending = listPending();
  if (!pending.length) return ctx.reply("no pending proposals");
  const { threshold, members } = loadMembers();
  const text = pending.slice(0, 5).map((p) => formatProposal(p, threshold, members.length)).join("\n\n");
  return ctx.reply(text, { parse_mode: "Markdown" });
}

async function onExecuted(ctx) {
  const x = listExecuted(10);
  if (!x.length) return ctx.reply("no executed proposals yet");
  const txt = x.map((p) => {
    const o = p.op;
    const sum = o.op === "swap"   ? `swap ${o.amount} ${o.from.symbol}→${o.to.symbol}`
              : o.op === "bridge" ? `bridge ${o.amount} ${o.from.symbol} ${o.chain}→${o.toChain}`
              :                     `send ${o.amount} ${o.from.symbol}`;
    return `• \`${p.id}\` ${sum} on *${o.chain}* → \`${p.txHash ?? "n/a"}\``;
  }).join("\n");
  return ctx.reply(`*Recent executions*\n${txt}`, { parse_mode: "Markdown" });
}

/* ------------------------------- dispatch ---------------------------- */

async function executeOnchain(p) {
  const nonce = p.op.nonce;
  if (p.op.op === "swap")   return executeSwap(p.op, nonce);
  if (p.op.op === "bridge") return executeBridge(p.op, nonce);
  if (p.op.op === "send")   return executeSend(p.op, nonce);
  throw new Error("unknown op: " + p.op.op);
}

function explorerUrl(chain, tx) {
  const map = {
    ethereum: "https://etherscan.io/tx/",
    base:     "https://basescan.org/tx/",
    arbitrum: "https://arbiscan.io/tx/",
    optimism: "https://optimistic.etherscan.io/tx/",
    polygon:  "https://polygonscan.com/tx/",
    solana:   "https://solscan.io/tx/",
  };
  return (map[chain] ?? "") + tx;
}
