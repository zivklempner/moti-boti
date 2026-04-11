require("dotenv").config();

const express = require("express");
const path = require("path");
const { initFirebase } = require("./firebase");
const { initWhatsApp, sendToGroup, sendDM, getCurrentQR, isClientReady } = require("./whatsapp");
const { processMessage, processReceiptPdf } = require("./claude");

const { logMessage } = require("./chat");
const { startWeeklySummary } = require("./cron");

// Name map: E.164 phone → display name
const PHONE_NAMES = {
  [process.env.USER1_PHONE]: process.env.USER1_NAME || "User1",
  [process.env.USER2_PHONE]: process.env.USER2_NAME || "User2",
};

function resolveName(phone) {
  // phone comes as "972507556620" (no +), normalize to +972...
  const e164 = phone.startsWith("+") ? phone : `+${phone}`;
  return PHONE_NAMES[e164] || phone;
}

// ─── Message handler ──────────────────────────────────────────────────────────

async function handleGroupMessage(msg) {
  try {
    // Only handle text messages from the configured group
    const groupId = process.env.WHATSAPP_GROUP_ID;

    // If no group ID set yet, log incoming group IDs to help the user find theirs
    if (!groupId) {
      if (msg.from.endsWith("@g.us")) {
        console.log(`\n📋 Group message detected!`);
        console.log(`Set this in Railway env vars:\n  WHATSAPP_GROUP_ID=${msg.from}\n`);
      }
      return;
    }

    if (msg.from !== groupId) return;     // wrong group
    // Log all incoming message types for debugging
    console.log(`MSG type=${msg.type} hasMedia=${msg.hasMedia} mime=${msg.mimetype} file=${msg.filename}`);
    // Allow text messages and PDF documents
    const isPdf = msg.type === "document" && msg.hasMedia &&
      (msg.mimetype === "application/pdf" || (msg.filename || "").endsWith(".pdf"));
    if (msg.type !== "chat" && !isPdf) return;

    const authorPhone = (msg.author || msg.from).replace("@c.us", "").replace("@g.us", "");
    const senderName = resolveName(authorPhone);
    const me = { name: senderName, phone: `+${authorPhone}` };

    console.log(`[${senderName}] from=${msg.from} type=${msg.type}${isPdf ? " (PDF)" : ""}`);

    let replyText, calendarUrl;

    // ── PDF receipt upload ────────────────────────────────────────────────────
    if (isPdf) {
      await logMessage(senderName, `[קבלה PDF: ${msg.filename || "receipt.pdf"}]`, me.phone);
      try {
        const media = await msg.downloadMedia();
        if (!media || !media.data) throw new Error("Failed to download PDF");
        const result = await processReceiptPdf(media.data, me, groupId);
        replyText = result.text;
      } catch (err) {
        console.error("processReceiptPdf error:", err.message);
        replyText = "מצטער, לא הצלחתי לעבד את הקבלה. נסה שוב.";
      }

    // ── Regular text message ──────────────────────────────────────────────────
    } else {
      const text = msg.body?.trim();
      if (!text) return;

      await logMessage(senderName, text, me.phone);

      try {
        const result = await processMessage(text, me, groupId);
        replyText = result.text;
        calendarUrl = result.calendarUrl;
      } catch (err) {
        console.error("processMessage error:", err.message, err.status || "", JSON.stringify(err.error || ""));
        replyText = "מצטער, משהו השתבש. נסה שוב.";
      }

      // "דחוף" escalation — privately DM the OTHER family member
      if (text.startsWith("דחוף")) {
        const allPhones = [process.env.USER1_PHONE, process.env.USER2_PHONE].filter(Boolean);
        const senderE164 = me.phone;
        const otherPhone = allPhones.find((p) => p !== senderE164);
        if (otherPhone) {
          try {
            const urgentDm = `🚨 *הודעה דחופה מ-${senderName}:*\n${text}`;
            await sendDM(otherPhone, urgentDm);
            console.log(`Urgent DM sent to ${otherPhone}`);
          } catch (dmErr) {
            console.error("Failed to send urgent DM:", dmErr.message);
          }
        }
      }
    }

    console.log(`Bot reply: ${replyText.substring(0, 80)}`);
    await logMessage("Bot", replyText);
    await sendToGroup(groupId, replyText);

    // Always send calendar URL as a separate message so it's never missed
    if (calendarUrl) {
      const urlMsg = `📅 לחצו להוספה ליומן:\n${calendarUrl}`;
      await logMessage("Bot", urlMsg);
      await sendToGroup(groupId, urlMsg);
    }
  } catch (err) {
    console.error("Message handler error:", err.message, err.stack);
  }
}

// ─── Express ──────────────────────────────────────────────────────────────────

initFirebase();

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Dashboard
app.get("/dashboard/config.js", (_req, res) => {
  res.type("application/javascript").send(`
window.FIREBASE_CONFIG = {
  projectId:   ${JSON.stringify(process.env.FIREBASE_PROJECT_ID)},
  databaseURL: ${JSON.stringify(process.env.FIREBASE_DATABASE_URL)},
  appId:       "grocery-chat-dashboard"
};
  `.trim());
});
app.use("/dashboard", express.static(path.join(__dirname, "../public")));

// QR code page
app.get("/qr", (_req, res) => {
  if (isClientReady()) {
    return res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px">
      <h2>✅ WhatsApp Connected!</h2>
      <p>The bot is online and ready. No QR scan needed.</p>
    </body></html>`);
  }

  const qr = getCurrentQR();
  if (!qr) {
    return res.send(`<!DOCTYPE html><html><head>
      <meta http-equiv="refresh" content="3">
    </head><body style="font-family:sans-serif;text-align:center;padding:60px">
      <h2>⏳ Initializing WhatsApp...</h2>
      <p>Please wait — QR code is being generated. This page refreshes automatically.</p>
    </body></html>`);
  }

  res.send(`<!DOCTYPE html>
<html lang="he">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Scan WhatsApp QR</title>
  <meta http-equiv="refresh" content="30">
  <style>
    body { font-family: sans-serif; text-align: center; padding: 40px; background: #f0f2f5; }
    .card { background: white; border-radius: 16px; padding: 32px; display: inline-block; box-shadow: 0 2px 12px rgba(0,0,0,.1); }
    h1 { color: #075e54; margin-top: 0; }
    img { width: 280px; height: 280px; border: 4px solid #25d366; border-radius: 8px; }
    p { color: #555; font-size: 15px; }
    .steps { text-align: left; margin: 16px auto; max-width: 300px; }
    .steps li { margin: 8px 0; color: #333; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🛒 Scan to Connect Bot</h1>
    <img src="${qr}" alt="WhatsApp QR Code">
    <p>Scan this QR with the <strong>bot's eSIM WhatsApp</strong></p>
    <ol class="steps">
      <li>Open WhatsApp on the eSIM number</li>
      <li>Tap ⋮ → Linked Devices → Link a Device</li>
      <li>Scan the QR code above</li>
    </ol>
    <p style="color:#999;font-size:12px">Page auto-refreshes every 30 seconds</p>
  </div>
</body>
</html>`);
});

// Health check
app.get("/", (_req, res) =>
  res.json({ status: "ok", whatsapp: isClientReady() ? "connected" : "connecting" })
);

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`QR page: http://localhost:${PORT}/qr`);
  startWeeklySummary();
});

// Initialize WhatsApp client (non-blocking — server starts first)
// Retry once on failure (e.g. bad saved session) so a fresh QR is generated
initWhatsApp(handleGroupMessage).catch(async (err) => {
  console.error("WhatsApp init failed:", err.message, "— clearing saved session and retrying...");
  try {
    const { getDb } = require("./firebase");
    await getDb().ref("whatsapp-session").remove();
    console.log("Cleared stale session from Firebase, restarting WhatsApp client...");
    await initWhatsApp(handleGroupMessage);
  } catch (err2) {
    console.error("WhatsApp retry also failed:", err2.message);
  }
});
