/**
 * Local HTTP API that wraps all bot tool logic.
 * OpenClaw skills call these endpoints instead of running Firebase/Sheets/etc. directly.
 * Run alongside OpenClaw: pm2 start tools-server.js --name moti-tools
 */

require("dotenv").config();
const express = require("express");
const fb = require("./src/firebase");
const expenses = require("./src/expenses");
const { buildGoogleCalendarUrl } = require("./src/calendar");
const { logReceipt, getReceiptReport } = require("./src/receipts");
const { saveReminder } = require("./src/reminders");
const { compareProductPrices } = require("./src/prices");
const { getEntertainment } = require("./src/mevalim");

const app = express();
app.use(express.json());
const PORT = process.env.TOOLS_PORT || 3001;

// ── Grocery ─────────────────────────────────────────────────────────────────

app.get("/grocery/list", async (req, res) => {
  const items = await fb.getListArray();
  res.json({
    items: items.map((item, i) => ({
      number: i + 1,
      name: item.name,
      bought: item.bought,
      boughtBy: item.boughtBy || null,
    })),
    total: items.length,
    pending: items.filter((i) => !i.bought).length,
  });
});

app.post("/grocery/add", async (req, res) => {
  const { items } = req.body;
  for (const item of items) await fb.addItem(item);
  res.json({ success: true, added: items });
});

app.post("/grocery/done", async (req, res) => {
  const { query, by } = req.body;
  const items = await fb.getListArray();
  const item = resolveItem(items, query);
  if (!item) return res.json({ success: false, error: "Item not found" });
  if (item.bought) return res.json({ success: false, error: "Already bought", itemName: item.name });
  await fb.markBought(item.id, by || "מוטי");
  res.json({ success: true, itemName: item.name });
});

app.post("/grocery/remove", async (req, res) => {
  const { query } = req.body;
  const items = await fb.getListArray();
  const item = resolveItem(items, query);
  if (!item) return res.json({ success: false, error: "Item not found" });
  await fb.removeItem(item.id);
  res.json({ success: true, itemName: item.name });
});

app.post("/grocery/clear", async (req, res) => {
  await fb.clearList();
  res.json({ success: true });
});

// ── Expenses ─────────────────────────────────────────────────────────────────

app.post("/expenses/log", async (req, res) => {
  const { amount, merchant, paid_by, raw_text, date } = req.body;
  const expense = await expenses.logExpense(
    amount, merchant, paid_by || "לא ידוע", raw_text || "", "openclaw", date || null
  );
  const monthKey = date ? date.substring(0, 7) : expenses.currentMonthKey();
  const categoryTotal = await expenses.getCategoryTotal(monthKey, expense.category);
  res.json({
    success: true,
    expense: { id: expense.id, merchant: expense.merchant, amount: expense.amount, category: expense.category, paid_by: expense.paid_by },
    categoryNameHe: expenses.CATEGORY_NAMES_HE[expense.category] || expense.category,
    categoryEmoji: expenses.CATEGORY_EMOJIS[expense.category] || "📦",
    categoryMonthlyTotal: Math.round(categoryTotal),
  });
});

app.post("/expenses/edit", async (req, res) => {
  const { merchant_search, date_filter, most_recent, updates } = req.body;
  const matches = await expenses.findRecentExpenses({
    merchantQuery: merchant_search,
    dateFilter: date_filter,
    limit: most_recent ? 1 : 5,
  });
  if (matches.length === 0)
    return res.json({ success: false, error: "לא נמצאה הוצאה תואמת" });
  if (matches.length > 1 && !most_recent)
    return res.json({
      success: false,
      multiple_matches: true,
      expenses: matches.map((e) => ({ merchant: e.merchant, amount: e.amount, date: (e.timestamp || "").substring(0, 10), paid_by: e.paid_by })),
    });
  const target = matches[0];
  const updated = await expenses.editExpense(target.id, target.month_key, updates);
  res.json({
    success: true,
    expense: { merchant: updated.merchant, amount: updated.amount, date: (updated.timestamp || "").substring(0, 10), paid_by: updated.paid_by, category: updated.category },
    categoryNameHe: expenses.CATEGORY_NAMES_HE[updated.category] || updated.category,
  });
});

app.get("/expenses/summary", async (req, res) => {
  const now = new Date();
  const year = parseInt(req.query.year) || now.getFullYear();
  const month = parseInt(req.query.month) || now.getMonth() + 1;
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const total = await expenses.getMonthlyTotal(monthKey);
  const topMerchants = await expenses.getTopMerchants(monthKey, 5);
  const categoryBreakdown = {};
  for (const cat of Object.keys(expenses.CATEGORY_NAMES_HE)) {
    const catTotal = await expenses.getCategoryTotal(monthKey, cat);
    if (catTotal > 0)
      categoryBreakdown[cat] = { nameHe: expenses.CATEGORY_NAMES_HE[cat], emoji: expenses.CATEGORY_EMOJIS[cat], total: Math.round(catTotal) };
  }
  res.json({ monthKey, total: Math.round(total), categoryBreakdown, topMerchants });
});

app.get("/expenses/balance", async (req, res) => {
  res.json(await expenses.getBalance());
});

app.get("/expenses/report", async (req, res) => {
  const { year, month } = req.query;
  res.json(await expenses.getMonthlyReport(parseInt(year), parseInt(month)));
});

// ── Receipts ─────────────────────────────────────────────────────────────────

app.post("/receipts/log", async (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  const key = await logReceipt(req.body.saved_by || "מוטי", { ...req.body, date: req.body.date || today });
  res.json({ success: true, receiptId: key, store: req.body.store, date: req.body.date || today, total: req.body.total, itemCount: (req.body.items || []).length });
});

app.get("/receipts/report", async (req, res) => {
  res.json(await getReceiptReport(parseInt(req.query.year), parseInt(req.query.month)));
});

// ── Calendar ─────────────────────────────────────────────────────────────────

app.post("/calendar/invite", async (req, res) => {
  const { title, start_iso, end_iso, location } = req.body;
  const url = buildGoogleCalendarUrl({ title, start: new Date(start_iso), end: end_iso ? new Date(end_iso) : null, location: location || "" });
  res.json({ success: true, title, start_iso, googleCalendarUrl: url });
});

// ── Reminders ────────────────────────────────────────────────────────────────

app.post("/reminders/set", async (req, res) => {
  const { text, scheduled_iso, created_by } = req.body;
  const groupId = process.env.TELEGRAM_CHAT_ID;
  const reminder = await saveReminder({ text, scheduledIso: scheduled_iso, createdBy: created_by || "מוטי", groupId });
  res.json({ success: true, text: reminder.text, scheduled_iso: reminder.scheduled_iso });
});

// ── Prices ───────────────────────────────────────────────────────────────────

app.post("/prices/compare", async (req, res) => {
  const { product, city } = req.body;
  const result = await compareProductPrices(product, city);
  if (result.notFound) return res.json({ success: false, message: `לא נמצא מוצר "${product}"` });
  res.json({ success: true, product: result.product, manufacturer: result.manufacturer, barcode: result.barcode, priceRange: result.priceRange, city: result.city, chains: result.chains });
});

// ── Shows ─────────────────────────────────────────────────────────────────────

app.post("/shows/find", async (req, res) => {
  const { category, region } = req.body;
  const result = await getEntertainment(category, region || "");
  if (result.notFound) return res.json({ success: false, message: `לא נמצאו הופעות בקטגוריה "${category}"` });
  res.json({ success: true, category: result.category, categoryLabel: result.categoryLabel, region: result.region, total: result.total, shows: result.shows.slice(0, 15) });
});

// ── Health ────────────────────────────────────────────────────────────────────

app.get("/health", (req, res) => res.json({ status: "ok", port: PORT }));

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveItem(items, query) {
  const num = parseInt(query, 10);
  if (!isNaN(num)) return items[num - 1] || null;
  const q = query.toLowerCase();
  return items.find((i) => i.name.toLowerCase() === q) || items.find((i) => i.name.toLowerCase().includes(q)) || null;
}

app.listen(PORT, () => console.log(`Moti tools API running on :${PORT}`));
