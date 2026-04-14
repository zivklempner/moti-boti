// Cloud Functions entry point — replaces src/index.js for the GCP deployment.
// Local testing: npx @google-cloud/functions-framework --target=motiWebhook
require("dotenv").config();

const { initFirebase, getListArray } = require("./firebase");
const { getBot, downloadTelegramFile, sendToGroup, sendDM } = require("./telegram");
const { processMessage, processReceiptPdf, processReceiptImage } = require("./claude");
const { transcribeAudio } = require("./whisper");
const { logMessage } = require("./chat");
const { getMonthlyReport } = require("./expenses");
const { getDueReminders, markReminderSent } = require("./reminders");

// Firebase must be initialised once per cold start
initFirebase();

// ─── Sender resolution ────────────────────────────────────────────────────────
// Maps Telegram user IDs → configured display names.
// Falls back to ctx.from.first_name for unknown users.

function buildUserMap() {
  const map = {};
  if (process.env.USER1_TELEGRAM_ID) map[process.env.USER1_TELEGRAM_ID] = process.env.USER1_NAME || "User1";
  if (process.env.USER2_TELEGRAM_ID) map[process.env.USER2_TELEGRAM_ID] = process.env.USER2_NAME || "User2";
  return map;
}

function resolveSender(ctx) {
  const userMap  = buildUserMap();
  const userId   = String(ctx.from.id);
  const name     = userMap[userId] || ctx.from.first_name || "Unknown";
  return { name, telegramId: userId };
}

// ─── Urgent DM ────────────────────────────────────────────────────────────────

async function sendUrgentDm(senderName, senderId, text) {
  const allIds  = [process.env.USER1_TELEGRAM_ID, process.env.USER2_TELEGRAM_ID].filter(Boolean);
  const otherId = allIds.find(id => id !== senderId);
  if (!otherId) return;
  try {
    await sendDM(otherId, `🚨 *הודעה דחופה מ-${senderName}:*\n${text}`);
    console.log(`Urgent DM sent to Telegram user ${otherId}`);
  } catch (err) {
    console.error("Failed to send urgent DM:", err.message);
  }
}

// ─── Message handler ──────────────────────────────────────────────────────────

async function handleMessage(ctx) {
  const configuredChatId = process.env.TELEGRAM_CHAT_ID;

  // Only respond in the configured group (ignore other chats / DMs to the bot)
  if (configuredChatId && String(ctx.chat.id) !== String(configuredChatId)) return;

  const msg = ctx.message;
  if (!msg) return;

  const { name: senderName, telegramId } = resolveSender(ctx);
  const me       = { name: senderName, telegramId };
  const groupKey = String(ctx.chat.id); // used as history key

  const isPdf   = !!msg.document && msg.document.mime_type === "application/pdf";
  const isImage = !!msg.photo && msg.photo.length > 0;
  const isVoice = !!(msg.voice || msg.audio);
  const isText  = !!msg.text;

  if (!isPdf && !isImage && !isVoice && !isText) return;

  const typeTag = isPdf ? "pdf" : isImage ? "image" : isVoice ? "voice" : "text";
  console.log(`[${senderName}] chat=${groupKey} type=${typeTag}`);

  let replyText, calendarUrl;

  // ── PDF receipt ─────────────────────────────────────────────────────────────
  if (isPdf) {
    await logMessage(senderName, `[קבלה PDF: ${msg.document.file_name || "receipt.pdf"}]`, telegramId);
    try {
      const base64 = await downloadTelegramFile(msg.document.file_id);
      const result  = await processReceiptPdf(base64, me, groupKey);
      replyText = result.text;
    } catch (err) {
      console.error("PDF receipt error:", err.message, err.stack);
      replyText = "מצטער, לא הצלחתי לעבד את הקבלה. נסה שוב.";
    }

  // ── Image receipt ────────────────────────────────────────────────────────────
  } else if (isImage) {
    await logMessage(senderName, "[קבלה תמונה]", telegramId);
    try {
      const photo  = msg.photo[msg.photo.length - 1]; // largest available size
      const base64 = await downloadTelegramFile(photo.file_id);
      const result  = await processReceiptImage(base64, "image/jpeg", me);
      replyText = result.text;
    } catch (err) {
      console.error("Image receipt error:", err.message, err.stack);
      replyText = "מצטער, לא הצלחתי לעבד את התמונה. נסה שוב.";
    }

  // ── Voice message ────────────────────────────────────────────────────────────
  } else if (isVoice) {
    await logMessage(senderName, "[הודעה קולית]", telegramId);
    if (!process.env.OPENAI_API_KEY) {
      replyText = "קליטת הודעות קוליות עדיין לא מוגדרת. יש להגדיר OPENAI_API_KEY.";
    } else {
      try {
        const file   = msg.voice || msg.audio;
        const base64 = await downloadTelegramFile(file.file_id);
        const transcript = await transcribeAudio(base64, "audio/ogg; codecs=opus");
        console.log(`Voice transcript: "${transcript}"`);
        if (!transcript) {
          replyText = "לא הצלחתי להבין את ההודעה הקולית. נסה שוב.";
        } else {
          await logMessage(senderName, `[קולי]: ${transcript}`, telegramId);
          const result = await processMessage(transcript, me, groupKey);
          replyText    = result.text;
          calendarUrl  = result.calendarUrl;
          if (transcript.startsWith("דחוף")) {
            await sendUrgentDm(senderName, telegramId, transcript);
          }
        }
      } catch (err) {
        const detail = err.response?.data ? JSON.stringify(err.response.data) : (err.cause?.message || "");
        console.error("Voice processing error:", err.message, detail, err.stack);
        replyText = "מצטער, לא הצלחתי לעבד את ההודעה הקולית.";
      }
    }

  // ── Text message ─────────────────────────────────────────────────────────────
  } else {
    const text = msg.text?.trim();
    if (!text) return;

    await logMessage(senderName, text, telegramId);

    try {
      const result = await processMessage(text, me, groupKey);
      replyText   = result.text;
      calendarUrl = result.calendarUrl;
    } catch (err) {
      console.error("processMessage error:", err.message, err.status || "", JSON.stringify(err.error || ""));
      replyText = "מצטער, משהו השתבש. נסה שוב.";
    }

    if (text.startsWith("דחוף")) {
      await sendUrgentDm(senderName, telegramId, text);
    }
  }

  if (!replyText) return;

  console.log(`Bot reply: ${replyText.substring(0, 80)}`);
  await logMessage("Bot", replyText);
  await sendToGroup(groupKey, replyText);

  if (calendarUrl) {
    const urlMsg = `📅 לחצו להוספה ליומן:\n${calendarUrl}`;
    await logMessage("Bot", urlMsg);
    await sendToGroup(groupKey, urlMsg);
  }
}

// ─── Register handler with Telegraf ──────────────────────────────────────────

const bot = getBot();

bot.on("message", async (ctx) => {
  try {
    await handleMessage(ctx);
  } catch (err) {
    console.error("Message handler error:", err.message, err.stack);
  }
});

// ─── Cron helpers ─────────────────────────────────────────────────────────────

const hebrewMonths = [
  "ינואר","פברואר","מרץ","אפריל","מאי","יוני",
  "יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר",
];

async function runWeeklySummary() {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) throw new Error("TELEGRAM_CHAT_ID not set");

  const now      = new Date();
  const items    = await getListArray();
  const report   = await getMonthlyReport(now.getFullYear(), now.getMonth() + 1);
  const pending  = items.filter(i => !i.bought).length;
  const bought   = items.filter(i =>  i.bought).length;
  const monthName = hebrewMonths[now.getMonth()];

  let msg =
    `🛒 *סיכום שבועי — מוטי מדווח*\n\n` +
    `*רשימת הקניות:*\n• ${pending} פריטים ממתינים\n• ${bought} פריטים שנקנו\n\n`;

  if (report.total > 0) {
    msg += `📊 *הוצאות ${monthName}:*\n`;
    for (const [store, amount] of Object.entries(report.byStore)) {
      msg += `• ${store}: ${amount.toLocaleString()} ₪\n`;
    }
    msg += `\nסה"כ: ${report.total.toLocaleString()} ₪`;
  }
  msg += `\n\nשבת שלום! 😊`;

  await sendToGroup(chatId, msg);
  console.log("Weekly summary sent.");
}

async function runEventScraper() {
  const { runAllScrapers } = require("./scrapers/index");
  await runAllScrapers();
  console.log("Event scraper completed.");
}

async function runReminderCheck() {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const due    = await getDueReminders();
  for (const r of due) {
    try {
      const target = r.group_id || chatId;
      await sendToGroup(target, `🔔 *תזכורת מ-${r.created_by}:*\n${r.text}`);
      await markReminderSent(r.id);
      console.log(`Reminder sent: "${r.text.substring(0, 60)}"`);
    } catch (err) {
      console.error("Failed to send reminder:", err.message);
    }
  }
}

// ─── Cloud Function: motiWebhook ─────────────────────────────────────────────
/**
 * Receives Telegram updates via webhook.
 * MUST always respond HTTP 200 — any non-200 causes Telegram to retry.
 */
exports.motiWebhook = async (req, res) => {
  try {
    await bot.handleUpdate(req.body);
  } catch (err) {
    console.error("Webhook error:", err.message, err.stack);
  }
  res.sendStatus(200);
};

// ─── Cloud Function: motiCron ────────────────────────────────────────────────
/**
 * Triggered by Cloud Scheduler.
 * Expects body or query param: { job: "weekly_summary" | "event_scraper" | "reminders" }
 * Secured by CRON_SECRET env var — Cloud Scheduler sends it as ?secret=...
 */
exports.motiCron = async (req, res) => {
  // Simple shared-secret guard
  const secret = req.query.secret || req.headers["x-cron-secret"];
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    console.warn("motiCron: unauthorized request");
    return res.status(401).json({ error: "Unauthorized" });
  }

  const job = req.body?.job || req.query?.job;
  console.log(`Cron triggered: ${job}`);

  try {
    switch (job) {
      case "weekly_summary": await runWeeklySummary(); break;
      case "event_scraper":  await runEventScraper();  break;
      case "reminders":      await runReminderCheck(); break;
      default:
        console.warn(`Unknown cron job: "${job}"`);
        return res.status(400).json({ error: `Unknown job: ${job}` });
    }
    res.json({ success: true, job });
  } catch (err) {
    console.error(`Cron ${job} failed:`, err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
};
