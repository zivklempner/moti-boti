const { Telegraf } = require("telegraf");
const axios = require("axios");

let _bot = null;

/**
 * Returns the singleton Telegraf instance.
 * Lazily initialised so the module can be required without crashing
 * when TELEGRAM_BOT_TOKEN is not yet set (e.g. during local Railway runs).
 */
function getBot() {
  if (!_bot) _bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
  return _bot;
}

/**
 * Download any Telegram file (voice, photo, document) and return it
 * as a base64-encoded string.
 *
 * @param {string} fileId - Telegram file_id
 * @returns {Promise<string>} base64 data
 */
async function downloadTelegramFile(fileId) {
  const bot = getBot();
  const file = await bot.telegram.getFile(fileId);
  const url  = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  const resp = await axios.get(url, { responseType: "arraybuffer", timeout: 30_000 });
  return Buffer.from(resp.data).toString("base64");
}

/**
 * Send a message to the configured group (or an explicit chatId).
 * Falls back to plain text if Markdown parsing fails.
 *
 * @param {string|number} chatId
 * @param {string} text
 */
async function sendToGroup(chatId, text) {
  const bot      = getBot();
  const targetId = chatId || process.env.TELEGRAM_CHAT_ID;
  try {
    await bot.telegram.sendMessage(targetId, text, { parse_mode: "Markdown" });
  } catch (mdErr) {
    // Markdown parse error — retry as plain text
    if (mdErr.description?.includes("parse")) {
      await bot.telegram.sendMessage(targetId, text);
    } else {
      throw mdErr;
    }
  }
}

/**
 * Send a private DM to a specific Telegram user by their numeric user ID.
 *
 * @param {string|number} userId
 * @param {string} text
 */
async function sendDM(userId, text) {
  const bot = getBot();
  try {
    await bot.telegram.sendMessage(userId, text, { parse_mode: "Markdown" });
  } catch (mdErr) {
    if (mdErr.description?.includes("parse")) {
      await bot.telegram.sendMessage(userId, text);
    } else {
      throw mdErr;
    }
  }
}

module.exports = { getBot, downloadTelegramFile, sendToGroup, sendDM };
