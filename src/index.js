require("dotenv").config();

const express = require("express");
const path = require("path");
const { initFirebase } = require("./firebase");
const { initWhatsApp, sendToGroup, getCurrentQR, isClientReady } = require("./whatsapp");
const { processMessage } = require("./claude");
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
    if (msg.type !== "chat") return;      // ignore media/stickers/etc.
    if (!msg.body?.trim()) return;

    const authorPhone = (msg.author || msg.from).replace("@c.us", "").replace("@g.us", "");
    const senderName = resolveName(authorPhone);
    const text = msg.body.trim();

    console.log(`[${senderName}] from=${msg.from} author=${msg.author} type=${msg.type}: ${text}`);

    // Log to shared dashboard
    await logMessage(senderName, text, `+${authorPhone}`);

    // Process with Claude (history keyed by group ID so all members share context)
    let reply;
    try {
      reply = await processMessage(text, { name: senderName, phone: `+${authorPhone}` }, groupId);
    } catch (err) {
      console.error("processMessage error:", err.message, err.status || "", JSON.stringify(err.error || ""));
      reply = "מצטער, משהו השתבש. נסה שוב.";
    }

    console.log(`Bot reply: ${reply.substring(0, 80)}`);

    // Log bot reply to dashboard
    await logMessage("Bot", reply);

    await sendToGroup(groupId, reply);
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
initWhatsApp(handleGroupMessage).catch((err) => {
  console.error("WhatsApp init failed:", err.message);
});
