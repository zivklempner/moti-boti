const cron = require("node-cron");
const { getListArray, getDb } = require("./firebase");
const { getMonthlyReport } = require("./expenses");
const { sendToGroup, isClientReady } = require("./whatsapp");

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

// Daily briefing at 9 PM Israel time (UTC+3 = 18:00 UTC)
function startDailyBriefing() {
  cron.schedule("0 0 18 * * *", async () => {
    const groupId = process.env.WHATSAPP_GROUP_ID;
    if (!groupId || !isClientReady()) {
      console.log("Daily briefing skipped: bot not ready or no group configured.");
      return;
    }

    try {
      const now = new Date();
      const israelNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);
      const todayStr = israelNow.toISOString().split("T")[0];

      const items = await getListArray();
      const pendingItems = items.filter((i) => !i.bought);

      // Today's expenses — fetch raw entries from Firebase
      const monthKey = todayStr.substring(0, 7);
      const snap = await getDb().ref(`moti-boti/expenses/${monthKey}`).once("value");
      const expData = snap.val() || {};
      const todayExpenses = Object.values(expData).filter((e) => e.date === todayStr);

      let msg = `🌙 *מוטי — סיכום יומי*\n\n`;

      if (pendingItems.length === 0) {
        msg += `✅ הרשימה נקייה — כל הכבוד, קניתם הכל!\n`;
      } else {
        msg += `🛒 *עוד צריך לקנות (${pendingItems.length} פריטים):*\n`;
        pendingItems.forEach((item, i) => {
          msg += `${i + 1}. ${item.name}\n`;
        });
      }

      if (todayExpenses.length > 0) {
        const todayTotal = todayExpenses.reduce((sum, e) => sum + e.amount, 0);
        msg += `\n💰 *הוצאות היום:*\n`;
        todayExpenses.forEach((e) => {
          msg += `• ${e.store}: ${e.amount.toLocaleString()} ₪\n`;
        });
        msg += `סה"כ היום: ${todayTotal.toLocaleString()} ₪\n`;
      }

      msg += `\nלילה טוב 😴`;

      await sendToGroup(groupId, msg);
      console.log("Daily briefing sent to group.");
    } catch (err) {
      console.error("Daily briefing failed:", err.message);
    }
  });

  console.log("Daily briefing cron scheduled (9 PM Israel time).");
}

function startWeeklySummaryAndDailyBriefing() {
  startWeeklySummary();
  startDailyBriefing();
}

module.exports = { startWeeklySummary: startWeeklySummaryAndDailyBriefing };
