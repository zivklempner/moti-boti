const cron = require("node-cron");
const { getListArray } = require("./firebase");
const { send } = require("./twilio");
const { getUsers } = require("./users");

/**
 * Every Sunday at 9:00 AM (server local time) send both users a summary.
 * Cron: second minute hour day month weekday
 *       0     0      9    *   *     0 (0 = Sunday)
 */
function startWeeklySummary() {
  cron.schedule("0 0 9 * * 0", async () => {
    try {
      const items = await getListArray();
      const pending = items.filter((i) => !i.bought).length;
      const done = items.filter((i) => i.bought).length;
      const msg =
        `🛒 *Weekly Grocery Summary*\n` +
        `• ${pending} item${pending !== 1 ? "s" : ""} still needed\n` +
        `• ${done} item${done !== 1 ? "s" : ""} already bought\n\n` +
        `Reply *list* to see the full list.`;

      const users = getUsers();
      await Promise.all(users.map((u) => send(u.phone, msg)));
      console.log("Weekly summary sent.");
    } catch (err) {
      console.error("Weekly summary failed:", err.message);
    }
  });

  console.log("Weekly summary cron scheduled (Sundays 9 AM).");
}

module.exports = { startWeeklySummary };
