const { getDb } = require("./firebase");

async function logExpense(userName, { store, amount, date, category }) {
  const monthKey = date.substring(0, 7); // YYYY-MM
  const ref = getDb().ref(`moti-boti/expenses/${monthKey}`).push();
  await ref.set({
    store,
    amount: Number(amount),
    date,
    category: category || "general",
    loggedBy: userName,
    createdAt: Date.now(),
  });
  return ref.key;
}

async function getMonthlyReport(year, month) {
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const snap = await getDb().ref(`moti-boti/expenses/${monthKey}`).once("value");
  const data = snap.val() || {};

  const byStore = {};
  let total = 0;

  for (const entry of Object.values(data)) {
    byStore[entry.store] = (byStore[entry.store] || 0) + entry.amount;
    total += entry.amount;
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  const dailyAverage = total > 0 ? Math.round(total / daysInMonth) : 0;
  const entriesCount = Object.keys(data).length;

  return { year, month, monthKey, total, dailyAverage, byStore, entriesCount };
}

module.exports = { logExpense, getMonthlyReport };
