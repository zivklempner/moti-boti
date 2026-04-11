const { google } = require("googleapis");

// ─── Auth ─────────────────────────────────────────────────────────────────────

let _sheets = null;

/**
 * Returns an authenticated Google Sheets client.
 * Uses GOOGLE_SHEETS_CLIENT_EMAIL / GOOGLE_SHEETS_PRIVATE_KEY if set,
 * otherwise falls back to the Firebase service account credentials
 * (FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY) — no extra setup needed.
 * @returns {import("googleapis").sheets_v4.Sheets}
 */
function authenticateSheets() {
  if (_sheets) return _sheets;

  const client_email =
    process.env.GOOGLE_SHEETS_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL;
  const private_key = (
    process.env.GOOGLE_SHEETS_PRIVATE_KEY  || process.env.FIREBASE_PRIVATE_KEY || ""
  ).replace(/\\n/g, "\n");

  const auth = new google.auth.GoogleAuth({
    credentials: { client_email, private_key },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  _sheets = google.sheets({ version: "v4", auth });
  return _sheets;
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Appends one expense row to the "Raw" tab of the configured Google Sheet.
 * Columns: Date, Merchant, Category, Subcategory, Amount, Currency, Paid By, Source, ID.
 * Called fire-and-forget from logExpense() — never awaited by the bot.
 *
 * @param {object} expense - The expense object returned by logExpense()
 * @returns {Promise<void>}
 */
async function appendExpense(expense) {
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  if (!sheetId) return; // not configured — silently skip

  const sheets = authenticateSheets();

  const date = expense.timestamp
    ? expense.timestamp.substring(0, 10) // YYYY-MM-DD
    : expense.month_key + "-01";

  const row = [
    date,
    expense.merchant   || "",
    expense.category   || "",
    expense.subcategory || "",
    expense.amount     || 0,
    expense.currency   || "ILS",
    expense.paid_by    || "",
    expense.source     || "",
    expense.id         || "",
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "Raw!A:I",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
}

module.exports = { authenticateSheets, appendExpense };
