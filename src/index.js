require("dotenv").config();

const express = require("express");
const { initFirebase } = require("./firebase");
const { resolveUsers } = require("./users");
const { twimlReply } = require("./twilio");
const { processMessage } = require("./claude");
const { startWeeklySummary } = require("./cron");

initFirebase();

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get("/", (_req, res) => res.send("Grocery bot is running."));

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

    const reply = await processMessage(text, me, other);
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
