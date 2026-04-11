const { getDb } = require("./firebase");

async function logReceipt(userName, { store, branch, date, time, total, discount, items, paymentMethod, receiptNumber }) {
  const monthKey = date.substring(0, 7); // YYYY-MM
  const ref = getDb().ref(`receipts/${monthKey}`).push();
  await ref.set({
    store: store || "לא ידוע",
    branch: branch || "",
    date,
    time: time || "",
    total: Number(total) || 0,
    discount: Number(discount) || 0,
    items: items || [],
    paymentMethod: paymentMethod || "",
    receiptNumber: receiptNumber || "",
    loggedBy: userName,
    createdAt: Date.now(),
  });
  console.log(`Receipt logged: ${store} ${date} ${total}₪ (${(items || []).length} items)`);
  return ref.key;
}

async function getMonthlyReceipts(year, month) {
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const snap = await getDb().ref(`receipts/${monthKey}`).once("value");
  return Object.values(snap.val() || {});
}

async function getReceiptReport(year, month) {
  const receipts = await getMonthlyReceipts(year, month);

  if (receipts.length === 0) {
    return { year, month, totalReceipts: 0, totalSpent: 0, totalDiscount: 0, byStore: {}, topItems: [], categoryTotals: {} };
  }

  const totalSpent = receipts.reduce((s, r) => s + r.total, 0);
  const totalDiscount = receipts.reduce((s, r) => s + (r.discount || 0), 0);

  // By store
  const byStore = {};
  for (const r of receipts) {
    if (!byStore[r.store]) byStore[r.store] = { trips: 0, total: 0 };
    byStore[r.store].trips++;
    byStore[r.store].total += r.total;
  }

  // Item frequency and spend
  const itemMap = {};
  for (const r of receipts) {
    for (const item of (r.items || [])) {
      const key = item.name;
      if (!itemMap[key]) itemMap[key] = { name: item.name, count: 0, totalSpent: 0, category: item.category || "general" };
      itemMap[key].count += item.qty || 1;
      itemMap[key].totalSpent += item.lineTotal || 0;
    }
  }

  const topItems = Object.values(itemMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  // Category totals
  const categoryTotals = {};
  for (const item of Object.values(itemMap)) {
    const cat = item.category || "general";
    categoryTotals[cat] = (categoryTotals[cat] || 0) + item.totalSpent;
  }

  return {
    year,
    month,
    totalReceipts: receipts.length,
    totalSpent: Math.round(totalSpent * 100) / 100,
    totalDiscount: Math.round(totalDiscount * 100) / 100,
    avgPerTrip: Math.round((totalSpent / receipts.length) * 100) / 100,
    byStore,
    topItems,
    categoryTotals,
  };
}

module.exports = { logReceipt, getMonthlyReceipts, getReceiptReport };
