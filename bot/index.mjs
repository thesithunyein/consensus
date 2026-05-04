import { Telegraf } from "telegraf";
import { CFG } from "./config.mjs";
import { registerHandlers } from "./commands.mjs";

const bot = new Telegraf(CFG.tgToken);
registerHandlers(bot);

bot.catch((err, ctx) => {
  console.error(`[bot error] update=${ctx.update?.update_id}:`, err);
});

await bot.launch();
console.log(`✅ Consensus bot online.  state=${CFG.stateDir}  group=${CFG.groupChatId}`);

process.once("SIGINT",  () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
