const { v4: uuidv4 } = require("uuid");
const { getDb } = require("./firebase");
const { resolveCategory } = require("./merchants");


const CATEGORY_NAMES_HE = {
  groceries:     "מכולת",
  food:          "אוכל בחוץ",
  transport:     "תחבורה",
  health:        "בריאות",
  kids:          "ילדים",
  utilities:     "חשבונות",
  entertainment: "בידור",
  clothing:      "ביגוד",
  home:          "בית",
  other:         "אחר",
};

const CATEGORY_EMOJIS = {
  groceries:     "🛒",
  food:          "🍽️",
  transport:     "🚗",
  health:        "💊",
  kids:          "👶",
  utilities:     "💡",
  entertainment: "🎬",
  clothing:      "👕",
  home:          "🏠",
  other:         "📦",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nowIsrael() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000);
}

function toMonthPath(year, month) {
  return `${year}/${String(month).padStart(2, "0")}`;
}

function parseMonthKey(monthKey) {
  const [y, m] = monthKey.split("-");
  return { year: parseInt(y, 10), month: parseInt(m, 10) };
}

function currentMonthKey() {
  const now = nowIsrael();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ─── Core write ───────────────────────────────────────────────────────────────

/**
 * Log a new expense. Auto-categorizes via merchants.js, writes to Firebase,
 * and fires a Sheets sync in the background.
 *
 * @param {number} amount - Amount in NIS
 * @param {string} merchant - Merchant name (Hebrew or English)
 * @param {string} paidBy - Name of the person who paid
 * @param {string} rawText - Original message text verbatim
 * @param {string} source - e.g. "whatsapp_message" or "receipt_pdf"
 * @returns {Promise<object>} The saved expense object
 */
async function logExpense(amount, merchant, paidBy, rawText = "", source = "whatsapp_message") {
  const { category, subcategory } = await resolveCategory(merchant);

  const now = nowIsrael();
  const israelOffset = "+03:00";
  const timestamp =
    now.toISOString().replace("Z", "") + israelOffset;
  const monthKey = currentMonthKey();
  const { year, month } = parseMonthKey(monthKey);

  const id = uuidv4();
  const expense = {
    id,
    amount: Number(amount),
    currency: "ILS",
    merchant,
    category,
    subcategory,
    paid_by: paidBy,
    raw_text: rawText,
    source,
    receipt_ref: null,
    timestamp,
    month_key: monthKey,
  };

  await getDb()
    .ref(`expenses/${toMonthPath(year, month)}/${id}`)
    .set(expense);

  // Fire-and-forget Sheets sync — never blocks the bot reply
  try {
    const { appendExpense } = require("./sheets");
    appendExpense(expense).catch((err) =>
      console.error("Sheets sync failed:", err.message)
    );
  } catch (_) {
    // sheets.js may not be configured; silently skip
  }

  return expense;
}

// ─── Reads & aggregations ─────────────────────────────────────────────────────

/**
 * Fetch all raw expense entries for a given month.
 * @param {string} monthKey - "YYYY-MM"
 * @returns {Promise<object[]>}
 */
async function _getMonthExpenses(monthKey) {
  const { year, month } = parseMonthKey(monthKey);
  const snap = await getDb()
    .ref(`expenses/${toMonthPath(year, month)}`)
    .once("value");
  return Object.values(snap.val() || {});
}

/**
 * Total spend for a given month.
 * @param {string} monthKey - "YYYY-MM"
 * @returns {Promise<number>}
 */
async function getMonthlyTotal(monthKey) {
  const entries = await _getMonthExpenses(monthKey);
  return entries.reduce((s, e) => s + e.amount, 0);
}

/**
 * Total spend for one category in a given month.
 * @param {string} monthKey - "YYYY-MM"
 * @param {string} category
 * @returns {Promise<number>}
 */
async function getCategoryTotal(monthKey, category) {
  const entries = await _getMonthExpenses(monthKey);
  return entries
    .filter((e) => e.category === category)
    .reduce((s, e) => s + e.amount, 0);
}

/**
 * Total spend by one person in a given month.
 * @param {string} monthKey - "YYYY-MM"
 * @param {string} personName
 * @returns {Promise<number>}
 */
async function getPersonTotal(monthKey, personName) {
  const entries = await _getMonthExpenses(monthKey);
  return entries
    .filter((e) => e.paid_by === personName)
    .reduce((s, e) => s + e.amount, 0);
}

/**
 * Balance between the two configured family members for the current month.
 * Returns who owes whom and how much.
 * @returns {Promise<object>}
 */
async function getBalance() {
  const monthKey = currentMonthKey();
  const entries = await _getMonthExpenses(monthKey);

  const person1 = process.env.USER1_NAME || "User1";
  const person2 = process.env.USER2_NAME || "User2";

  const total1 = entries
    .filter((e) => e.paid_by === person1)
    .reduce((s, e) => s + e.amount, 0);
  const total2 = entries
    .filter((e) => e.paid_by === person2)
    .reduce((s, e) => s + e.amount, 0);

  const grandTotal = total1 + total2;
  const fairShare = grandTotal / 2;
  const diff = total1 - fairShare; // positive → person1 overpaid

  let owes = null;
  let owedTo = null;
  let amount = 0;

  if (diff > 0.5) {
    owes = person2;
    owedTo = person1;
    amount = Math.round(diff);
  } else if (diff < -0.5) {
    owes = person1;
    owedTo = person2;
    amount = Math.round(Math.abs(diff));
  }

  return {
    monthKey,
    totals: { [person1]: Math.round(total1), [person2]: Math.round(total2) },
    grandTotal: Math.round(grandTotal),
    fairShare: Math.round(fairShare),
    owes,
    owedTo,
    amount,
    balanced: amount === 0,
  };
}

/**
 * Top N merchants by spend for a given month.
 * @param {string} monthKey - "YYYY-MM"
 * @param {number} limit
 * @returns {Promise<Array<{ merchant: string, total: number, count: number }>>}
 */
async function getTopMerchants(monthKey, limit = 5) {
  const entries = await _getMonthExpenses(monthKey);
  const agg = {};
  for (const e of entries) {
    if (!agg[e.merchant]) agg[e.merchant] = { merchant: e.merchant, total: 0, count: 0 };
    agg[e.merchant].total += e.amount;
    agg[e.merchant].count += 1;
  }
  return Object.values(agg)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
    .map((m) => ({ ...m, total: Math.round(m.total) }));
}

// ─── Backward-compat: used by cron.js ────────────────────────────────────────

/**
 * Monthly report compatible with cron.js: returns { total, byStore, ... }.
 * Also used by the get_expense_report Claude tool.
 * @param {number} year
 * @param {number} month - 1-12
 * @returns {Promise<object>}
 */
async function getMonthlyReport(year, month) {
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const entries = await _getMonthExpenses(monthKey);

  const byStore = {};
  const byCategory = {};
  let total = 0;

  for (const e of entries) {
    byStore[e.merchant] = (byStore[e.merchant] || 0) + e.amount;
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
    total += e.amount;
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  const dailyAverage = total > 0 ? Math.round(total / daysInMonth) : 0;

  return {
    year,
    month,
    monthKey,
    total: Math.round(total),
    dailyAverage,
    byStore,
    byCategory,
    entriesCount: entries.length,
  };
}

module.exports = {
  logExpense,
  getMonthlyTotal,
  getCategoryTotal,
  getPersonTotal,
  getBalance,
  getTopMerchants,
  getMonthlyReport,
  currentMonthKey,
  CATEGORY_NAMES_HE,
  CATEGORY_EMOJIS,
};
