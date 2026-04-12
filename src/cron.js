const cron = require("node-cron");
const { getListArray } = require("./firebase");
const { getMonthlyReport } = require("./expenses");
const { sendToGroup, isClientReady } = require("./whatsapp");

function maybeRunScrapers() {
  const { runAllScrapers } = require("./scrapers/index");
  runAllScrapers().catch((err) => console.error("Scraper cron failed:", err.message));
}

const hebrewMonths = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

// Every Sunday at 9:00 AM Israel time (UTC+3 = 06:00 UTC)
function startWeeklySummary() {
  cron.schedule("0 0 6 * * 0", async () => {
    const groupId = process.env.WHATSAPP_GROUP_ID;
    if (!groupId || !isClientReady()) {
      console.log("Weekly summary skipped: bot not ready or no group configured.");
      return;
    }

    try {
      const now = new Date();
      const items = await getListArray();
      const report = await getMonthlyReport(now.getFullYear(), now.getMonth() + 1);

      const pending = items.filter((i) => !i.bought).length;
      const bought = items.filter((i) => i.bought).length;
      const monthName = hebrewMonths[now.getMonth()];

      let msg =
        `🛒 *סיכום שבועי — מוטי מדווח*\n\n` +
        `*רשימת הקניות:*\n` +
        `• ${pending} פריטים ממתינים\n` +
        `• ${bought} פריטים שנקנו\n\n`;

      if (report.total > 0) {
        msg += `📊 *הוצאות ${monthName}:*\n`;
        for (const [store, amount] of Object.entries(report.byStore)) {
          msg += `• ${store}: ${amount.toLocaleString()} ₪\n`;
        }
        msg += `\nסה"כ: ${report.total.toLocaleString()} ₪`;
      }

      msg += `\n\nשבת שלום! 😊`;

      await sendToGroup(groupId, msg);
      console.log("Weekly summary sent to group.");
    } catch (err) {
      console.error("Weekly summary failed:", err.message);
    }
  });

  console.log("Weekly summary cron scheduled (Sundays 9 AM Israel time).");
}


// Daily event scraper at 3 AM Israel time (UTC+3 → 00:00 UTC)
function startEventScraper() {
  maybeRunScrapers(); // seed on startup
  cron.schedule("0 0 0 * * *", maybeRunScrapers);
  console.log("Event scraper cron scheduled (daily 3 AM Israel time).");
}

function startWeeklySummaryAndDailyBriefing() {
  startWeeklySummary();
  startEventScraper();
}

module.exports = { startWeeklySummary: startWeeklySummaryAndDailyBriefing };
