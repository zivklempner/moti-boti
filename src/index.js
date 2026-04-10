require("dotenv").config();

const express = require("express");
const path = require("path");
const { initFirebase } = require("./firebase");
const { resolveUsers } = require("./users");
const { twimlReply } = require("./twilio");
const { processMessage } = require("./claude");
const { startWeeklySummary } = require("./cron");
const { logMessage } = require("./chat");

initFirebase();

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ─── Chat dashboard ───────────────────────────────────────────────────────────
// Serve Firebase client config as a JS file (keeps keys off the HTML page)
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

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/", (_req, res) => res.send("Grocery bot is running."));

// ─── Twilio webhook ───────────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  try {
    const from = req.body.From || "";
    const text = (req.body.Body || "").trim();

    if (!text) return res.sendStatus(200);

    const { me, other } = resolveUsers(from);

    if (!me) {
      console.warn(`Unregistered number: ${from}`);
      return twimlReply(res, "מספר הטלפון שלך אינו רשום במערכת.");
    }

    // Log user message to shared chat
    await logMessage(me.name, text, me.phone);

    const reply = await processMessage(text, me, other);

    // Log bot reply to shared chat
    await logMessage("Bot", reply);

    twimlReply(res, reply);
  } catch (err) {
    console.error("Webhook error:", err);
    twimlReply(res, "מצטער, אירעה שגיאה. נסה שוב.");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Grocery bot listening on port ${PORT}`);
  startWeeklySummary();
});
