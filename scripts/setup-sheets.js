/**
 * One-time setup script: configures the Moti Boti expense Google Sheet.
 * - Renames the first tab to "Raw" (or creates it if missing)
 * - Writes the header row
 * - Shares the sheet with both family members
 *
 * Run once: node scripts/setup-sheets.js
 */

require("dotenv").config();
const { google } = require("googleapis");

const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
const HEADERS  = ["תאריך", "עסק", "קטגוריה", "תת-קטגוריה", "סכום", "מטבע", "שולם על ידי", "מקור", "מזהה"];
const SHARE_WITH = [
  process.env.SHARE_EMAIL_1,
  process.env.SHARE_EMAIL_2,
].filter(Boolean);

async function main() {
  if (!SHEET_ID) {
    console.error("❌  GOOGLE_SHEETS_ID is not set in .env");
    process.exit(1);
  }
  if (!process.env.GOOGLE_SHEETS_CLIENT_EMAIL || !process.env.GOOGLE_SHEETS_PRIVATE_KEY) {
    console.error("❌  GOOGLE_SHEETS_CLIENT_EMAIL / GOOGLE_SHEETS_PRIVATE_KEY not set in .env");
    process.exit(1);
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
      private_key:  (process.env.GOOGLE_SHEETS_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    },
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const drive  = google.drive({ version: "v3", auth });

  // ── 1. Get existing sheet metadata ────────────────────────────────────────
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const existingSheets = meta.data.sheets || [];
  const rawSheet = existingSheets.find(s => s.properties.title === "Raw");
  const firstSheetId = existingSheets[0]?.properties?.sheetId;

  const requests = [];

  if (!rawSheet) {
    if (existingSheets.length === 1 && existingSheets[0].properties.title === "Sheet1") {
      // Rename the default Sheet1 → Raw
      requests.push({
        updateSheetProperties: {
          properties: { sheetId: firstSheetId, title: "Raw" },
          fields: "title",
        },
      });
      console.log("✅  Renamed Sheet1 → Raw");
    } else {
      // Add a new Raw tab
      requests.push({ addSheet: { properties: { title: "Raw" } } });
      console.log("✅  Added Raw tab");
    }
  } else {
    console.log("ℹ️   Raw tab already exists — skipping creation");
  }

  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests },
    });
  }

  // ── 2. Write header row ───────────────────────────────────────────────────
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: "Raw!A1:I1",
    valueInputOption: "RAW",
    requestBody: { values: [HEADERS] },
  });
  console.log("✅  Header row written:", HEADERS.join(", "));

  // ── 3. Bold the header row ────────────────────────────────────────────────
  const updatedMeta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const rawSheetId  = updatedMeta.data.sheets.find(s => s.properties.title === "Raw")?.properties?.sheetId;

  if (rawSheetId !== undefined) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [{
          repeatCell: {
            range: { sheetId: rawSheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: "userEnteredFormat.textFormat.bold",
          },
        }],
      },
    });
    console.log("✅  Header row bolded");
  }

  // ── 4. Share with family members ──────────────────────────────────────────
  for (const email of SHARE_WITH) {
    await drive.permissions.create({
      fileId: SHEET_ID,
      requestBody: { type: "user", role: "writer", emailAddress: email },
      sendNotificationEmail: false,
    });
    console.log(`✅  Shared with ${email}`);
  }

  if (SHARE_WITH.length === 0) {
    console.log("ℹ️   No SHARE_EMAIL_1 / SHARE_EMAIL_2 set — skipping sharing step");
  }

  console.log("\n🎉  Sheet setup complete!");
  console.log(`📋  URL: https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`);
  console.log(`\nAdd this to Railway → Variables:\n  GOOGLE_SHEETS_ID=${SHEET_ID}`);
}

main().catch(err => {
  console.error("❌  Setup failed:", err.message);
  process.exit(1);
});
