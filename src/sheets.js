const { google } = require("googleapis");

// ─── Auth ─────────────────────────────────────────────────────────────────────

let _sheets = null;

/**
 * Returns an authenticated Google Sheets client (singleton).
 * Falls back to Firebase service account credentials if dedicated Sheets
 * credentials are not set.
 * @returns {import("googleapis").sheets_v4.Sheets}
 */
function authenticateSheets() {
  if (_sheets) return _sheets;

  const client_email =
    process.env.GOOGLE_SHEETS_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL;
  const private_key = (
    process.env.GOOGLE_SHEETS_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY || ""
  ).replace(/\\n/g, "\n");

  const auth = new google.auth.GoogleAuth({
    credentials: { client_email, private_key },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  _sheets = google.sheets({ version: "v4", auth });
  return _sheets;
}

// ─── Lookup maps ──────────────────────────────────────────────────────────────

const CATEGORY_HE = {
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

const SOURCE_HE = {
  whatsapp_message: "וואטסאפ",
  receipt_pdf:      "קבלה",
  test_script:      "בדיקה",
  manual:           "ידני",
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Returns the numeric sheetId for a tab by name, or null if not found.
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} spreadsheetId
 * @param {string} title
 * @returns {Promise<number|null>}
 */
async function getSheetId(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets.find(s => s.properties.title === title);
  return sheet ? sheet.properties.sheetId : null;
}

/**
 * Ensures a tab exists. Creates it if missing. Returns its numeric sheetId.
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} spreadsheetId
 * @param {string} title
 * @returns {Promise<number>}
 */
async function ensureTab(sheets, spreadsheetId, title) {
  const existing = await getSheetId(sheets, spreadsheetId, title);
  if (existing !== null) return existing;

  const resp = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  });
  return resp.data.replies[0].addSheet.properties.sheetId;
}

/**
 * Reads all data rows from the Raw tab (skips header row 1).
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} spreadsheetId
 * @returns {Promise<Array<{date,merchant,category,subcategory,amount}>>}
 */
async function getRawRows(sheets, spreadsheetId) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Raw!A2:I",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  return (resp.data.values || [])
    .filter(r => r[1] && r[4] != null)
    .map(r => ({
      date:        String(r[0] || ""),
      merchant:    String(r[1] || ""),
      category:    String(r[2] || ""),
      subcategory: String(r[3] || ""),
      amount:      parseFloat(r[4]) || 0,
    }));
}

// ─── Refresh: Per Store tab ───────────────────────────────────────────────────

/**
 * Reads all rows from Raw, aggregates by merchant, and rewrites the "Per Store" tab.
 * Columns: עסק | קטגוריה | סה"כ ₪ | מספר עסקאות | ממוצע עסקה
 * Sorted by total spent descending.
 *
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} spreadsheetId
 * @returns {Promise<void>}
 */
async function refreshPerStoreTab(sheets, spreadsheetId) {
  try {
    const rows = await getRawRows(sheets, spreadsheetId);

    const agg = {};
    for (const r of rows) {
      if (!agg[r.merchant]) {
        agg[r.merchant] = { merchant: r.merchant, category: r.category, total: 0, count: 0 };
      }
      agg[r.merchant].total += r.amount;
      agg[r.merchant].count += 1;
    }

    const sorted = Object.values(agg).sort((a, b) => b.total - a.total);

    await ensureTab(sheets, spreadsheetId, "Per Store");

    const dataRows = [
      ["עסק", "קטגוריה", "סה\"כ ₪", "מספר עסקאות", "ממוצע עסקה"],
      ...sorted.map(m => [
        m.merchant,
        m.category,
        Math.round(m.total),
        m.count,
        Math.round(m.total / m.count),
      ]),
    ];

    await sheets.spreadsheets.values.clear({ spreadsheetId, range: "Per Store!A:E" });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Per Store!A1",
      valueInputOption: "RAW",
      requestBody: { values: dataRows },
    });

    console.log(`Per Store tab refreshed (${sorted.length} merchants)`);
  } catch (err) {
    console.error("refreshPerStoreTab failed:", err.message);
  }
}

// ─── Refresh: Monthly tab ─────────────────────────────────────────────────────

/**
 * Reads Raw rows for the given month, aggregates by category, and rewrites the
 * "Monthly" tab. Column D is a percentage formula.
 * Columns: קטגוריה | סה"כ ₪ | מספר עסקאות | % מסך ההוצאות
 *
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} spreadsheetId
 * @param {string} monthKey - "YYYY-MM"
 * @returns {Promise<void>}
 */
async function refreshMonthlyTab(sheets, spreadsheetId, monthKey) {
  try {
    const allRows = await getRawRows(sheets, spreadsheetId);
    const rows = allRows.filter(r => r.date.startsWith(monthKey));

    const agg = {};
    for (const r of rows) {
      const cat = r.category || "אחר";
      if (!agg[cat]) agg[cat] = { category: cat, total: 0, count: 0 };
      agg[cat].total += r.amount;
      agg[cat].count += 1;
    }

    const sorted = Object.values(agg).sort((a, b) => b.total - a.total);
    const lastDataRow = sorted.length + 1; // row index (1-based), +1 for header

    const headerRow = ["קטגוריה", "סה\"כ ₪", "מספר עסקאות", "% מסך ההוצאות"];
    const dataRows = sorted.map((c, i) => [
      c.category,
      Math.round(c.total),
      c.count,
      `=B${i + 2}/SUM($B$2:$B$${lastDataRow})`,
    ]);

    await ensureTab(sheets, spreadsheetId, "Monthly");
    await sheets.spreadsheets.values.clear({ spreadsheetId, range: "Monthly!A:D" });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Monthly!A1",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [headerRow, ...dataRows] },
    });

    // Format column D as percentage
    const monthlySheetId = await getSheetId(sheets, spreadsheetId, "Monthly");
    if (monthlySheetId !== null && sorted.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            repeatCell: {
              range: {
                sheetId:          monthlySheetId,
                startRowIndex:    1,
                endRowIndex:      lastDataRow,
                startColumnIndex: 3,
                endColumnIndex:   4,
              },
              cell: { userEnteredFormat: { numberFormat: { type: "PERCENT", pattern: "0.0%" } } },
              fields: "userEnteredFormat.numberFormat",
            },
          }],
        },
      });
    }

    console.log(`Monthly tab refreshed (${monthKey}, ${sorted.length} categories)`);
  } catch (err) {
    console.error("refreshMonthlyTab failed:", err.message);
  }
}

// ─── Charts setup ─────────────────────────────────────────────────────────────

/**
 * Creates two embedded charts in the "Charts" tab:
 *   1. Pie chart — "הוצאות לפי קטגוריה" sourced from the Monthly tab
 *   2. Column chart — "הוצאות לפי חנות (Top 15)" sourced from Per Store tab
 *
 * Idempotent: deletes any existing charts in the Charts tab before creating new ones.
 * Call once via GET /setup-charts after the first deploy.
 *
 * @returns {Promise<void>}
 */
async function setupCharts() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  if (!spreadsheetId) throw new Error("GOOGLE_SHEETS_ID not set");

  const sheets = authenticateSheets();

  // Ensure all required tabs exist
  const chartsSheetId   = await ensureTab(sheets, spreadsheetId, "Charts");
  const monthlySheetId  = await ensureTab(sheets, spreadsheetId, "Monthly");
  const perStoreSheetId = await ensureTab(sheets, spreadsheetId, "Per Store");

  // Remove existing charts in the Charts tab to avoid duplicates
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existingCharts = (meta.data.sheets || [])
    .flatMap(s => s.charts || [])
    .filter(c => c.position?.overlayPosition?.anchorCell?.sheetId === chartsSheetId);

  if (existingCharts.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: existingCharts.map(c => ({ deleteEmbeddedObject: { objectId: c.chartId } })),
      },
    });
  }

  const now = new Date();
  const monthsHe = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני",
                    "יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
  const monthLabel = `${monthsHe[now.getMonth()]} ${now.getFullYear()}`;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        // ── Chart 1: Pie — הוצאות לפי קטגוריה ──────────────────────────
        {
          addChart: {
            chart: {
              spec: {
                title: `הוצאות לפי קטגוריה — ${monthLabel}`,
                pieChart: {
                  legendPosition: "LABELED_LEGEND",
                  threeDimensional: false,
                  domain: {
                    sourceRange: {
                      sources: [{
                        sheetId:          monthlySheetId,
                        startRowIndex:    1,   // skip header
                        endRowIndex:      20,
                        startColumnIndex: 0,   // A: קטגוריה
                        endColumnIndex:   1,
                      }],
                    },
                  },
                  series: {
                    sourceRange: {
                      sources: [{
                        sheetId:          monthlySheetId,
                        startRowIndex:    1,
                        endRowIndex:      20,
                        startColumnIndex: 1,   // B: סה"כ ₪
                        endColumnIndex:   2,
                      }],
                    },
                  },
                },
              },
              position: {
                overlayPosition: {
                  anchorCell: { sheetId: chartsSheetId, rowIndex: 0, columnIndex: 0 },
                  widthPixels:  600,
                  heightPixels: 400,
                },
              },
            },
          },
        },

        // ── Chart 2: Column — הוצאות לפי חנות (Top 15) ──────────────────
        {
          addChart: {
            chart: {
              spec: {
                title: "הוצאות לפי חנות (Top 15)",
                basicChart: {
                  chartType:      "COLUMN",
                  legendPosition: "NO_LEGEND",
                  axis: [
                    { position: "BOTTOM_AXIS", title: "חנות" },
                    { position: "LEFT_AXIS",   title: "סכום (₪)" },
                  ],
                  domains: [{
                    domain: {
                      sourceRange: {
                        sources: [{
                          sheetId:          perStoreSheetId,
                          startRowIndex:    1,   // skip header
                          endRowIndex:      16,  // top 15 rows
                          startColumnIndex: 0,   // A: עסק
                          endColumnIndex:   1,
                        }],
                      },
                    },
                  }],
                  series: [{
                    series: {
                      sourceRange: {
                        sources: [{
                          sheetId:          perStoreSheetId,
                          startRowIndex:    1,
                          endRowIndex:      16,
                          startColumnIndex: 2,   // C: סה"כ ₪
                          endColumnIndex:   3,
                        }],
                      },
                    },
                    targetAxis: "LEFT_AXIS",
                  }],
                  headerCount: 0,
                },
              },
              position: {
                overlayPosition: {
                  anchorCell: { sheetId: chartsSheetId, rowIndex: 22, columnIndex: 0 },
                  widthPixels:  700,
                  heightPixels: 400,
                },
              },
            },
          },
        },
      ],
    },
  });

  console.log("Charts created successfully in Charts tab");
}

// ─── Main write ───────────────────────────────────────────────────────────────

/**
 * Appends one expense row to the "Raw" tab and fires background refreshes
 * of the "Per Store" and "Monthly" summary tabs.
 *
 * @param {object} expense - Expense object from logExpense()
 * @returns {Promise<void>}
 */
async function appendExpense(expense) {
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  if (!sheetId) return;

  const sheets = authenticateSheets();

  const date = expense.timestamp
    ? expense.timestamp.substring(0, 10)
    : expense.month_key + "-01";

  const row = [
    date,
    expense.merchant    || "",
    CATEGORY_HE[expense.category]    || expense.category    || "",
    expense.subcategory || "",
    expense.amount      || 0,
    "₪",
    expense.paid_by     || "",
    SOURCE_HE[expense.source] || expense.source || "",
    expense.id          || "",
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "Raw!A:I",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });

  // Fire-and-forget: rebuild summary tabs in parallel
  const monthKey = expense.month_key || date.substring(0, 7);
  Promise.all([
    refreshPerStoreTab(sheets, sheetId),
    refreshMonthlyTab(sheets, sheetId, monthKey),
  ]).then(() => console.log(`Sheets sync ✓ (${expense.merchant} ${expense.amount}₪)`))
    .catch(err => console.error("Sheets refresh failed:", err.message));
}

/**
 * Find an existing expense row by its ID (column I) and overwrite it in-place.
 * Also fires background refreshes of the summary tabs.
 *
 * @param {object} expense - Updated expense object (must have .id)
 * @returns {Promise<void>}
 */
async function updateExpenseRow(expense) {
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  if (!sheetId) return;

  const sheets = authenticateSheets();

  // Read all raw rows to locate the row by ID (column I, index 8)
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Raw!A2:I",
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const rows = resp.data.values || [];
  const rowIndex = rows.findIndex(r => r[8] === expense.id);

  if (rowIndex === -1) {
    console.warn(`Sheets updateExpenseRow: ID ${expense.id} not found in Raw tab — skipping`);
    return;
  }

  // Sheet rows are 1-indexed; row 1 is the header, data starts at row 2
  const sheetRow = rowIndex + 2;

  const date = expense.timestamp
    ? expense.timestamp.substring(0, 10)
    : expense.month_key + "-01";

  const updatedRow = [
    date,
    expense.merchant    || "",
    CATEGORY_HE[expense.category]    || expense.category    || "",
    expense.subcategory || "",
    expense.amount      || 0,
    "₪",
    expense.paid_by     || "",
    SOURCE_HE[expense.source] || expense.source || "",
    expense.id          || "",
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range:          `Raw!A${sheetRow}:I${sheetRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [updatedRow] },
  });

  // Fire-and-forget: rebuild summary tabs
  const monthKey = expense.month_key || date.substring(0, 7);
  Promise.all([
    refreshPerStoreTab(sheets, sheetId),
    refreshMonthlyTab(sheets, sheetId, monthKey),
  ]).then(() => console.log(`Sheets update ✓ (edit: ${expense.merchant} ${expense.amount}₪)`))
    .catch(err => console.error("Sheets refresh after edit failed:", err.message));
}

module.exports = { authenticateSheets, appendExpense, updateExpenseRow, setupCharts };
