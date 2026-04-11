require("dotenv").config();
const { appendExpense } = require("../src/sheets");

const testExpense = {
  id: "test-" + Date.now(),
  amount: 1,
  currency: "ILS",
  merchant: "TEST - delete me",
  category: "other",
  subcategory: "test",
  paid_by: "Ziv",
  source: "test_script",
  timestamp: new Date().toISOString(),
  month_key: "2026-04",
};

console.log("GOOGLE_SHEETS_ID:", process.env.GOOGLE_SHEETS_ID || "NOT SET");
console.log("FIREBASE_CLIENT_EMAIL:", process.env.FIREBASE_CLIENT_EMAIL || "NOT SET");
console.log("Testing Sheets connection...");

appendExpense(testExpense)
  .then(() => console.log("✅ Success — check the Raw tab in your sheet"))
  .catch(err => console.error("❌ Failed:", err.message));
