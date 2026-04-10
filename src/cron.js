const cron = require("node-cron");
const { getListArray } = require("./firebase");
const { getMonthlyReport } = require("./expenses");
const { send } = require("./twilio");
const { getUsers } = require("./users");

// Every Sunday at 9:00 AM server time
function startWeeklySummary() {
  cron.schedule("0 0 9 * * 0", async () => {
    try {
      const now = new Date();
      const items = await getListArray();
      const report = await getMonthlyReport(now.getFullYear(), now.getMonth() + 1);

      const pending = items.filter((i) => !i.bought).length;
      const bought = items.filter((i) => i.bought).length;

      const hebrewMonths = [
        "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
        "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
      ];
      const monthName = hebrewMonths[now.getMonth()];

      let msg =
        `🛒 *סיכום שבועי*\n\n` +
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

      const users = getUsers();
      await Promise.all(users.map((u) => send(u.phone, msg)));
      console.log("Weekly summary sent (Hebrew).");
    } catch (err) {
      console.error("Weekly summary failed:", err.message);
    }
  });

  console.log("Weekly summary cron scheduled (Sundays 9 AM).");
}

module.exports = { startWeeklySummary };
