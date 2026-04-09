require("dotenv").config();

const express = require("express");
const { initFirebase } = require("./firebase");
const { resolveUsers } = require("./users");
const { twimlReply } = require("./twilio");
const handlers = require("./handlers");
const { startWeeklySummary } = require("./cron");

// ─── Bootstrap ────────────────────────────────────────────────────────────────

initFirebase();

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ─── Health check ─────────────────────────────────────────────────────────────

app.get("/", (_req, res) => res.send("Grocery bot is running."));

// ─── Twilio webhook ───────────────────────────────────────────────────────────

app.post("/webhook", async (req, res) => {
  try {
    const from = req.body.From || "";           // e.g. "whatsapp:+15551234567"
    const rawText = (req.body.Body || "").trim();
    const text = rawText.toLowerCase();

    const { me, other } = resolveUsers(from);

    // Unknown sender
    if (!me) {
      console.warn(`Message from unregistered number: ${from}`);
      return twimlReply(res, "Sorry, your number is not registered for this list.");
    }

    // ── Route commands ────────────────────────────────────────────────────────

    if (text === "list") {
      return await handlers.handleList(res);
    }

    if (text === "clear") {
      return await handlers.handleClear(res, me);
    }

    if (text === "yes") {
      return await handlers.handleYes(res, me, other);
    }

    if (text === "help") {
      return await handlers.handleHelp(res);
    }

    if (text.startsWith("done ")) {
      const args = rawText.slice(5); // preserve original casing for display
      return await handlers.handleDone(res, args, me, other);
    }

    if (text.startsWith("remove ")) {
      const args = rawText.slice(7);
      return await handlers.handleRemove(res, args, me, other);
    }

    // Default: treat message as item(s) to add
    return await handlers.handleAdd(res, rawText, me, other);
  } catch (err) {
    console.error("Webhook error:", err);
    twimlReply(res, "Something went wrong. Please try again.");
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Grocery bot listening on port ${PORT}`);
  startWeeklySummary();
});
