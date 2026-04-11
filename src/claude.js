const Anthropic = require("@anthropic-ai/sdk");
const fb = require("./firebase");
const expenses = require("./expenses");
const { buildGoogleCalendarUrl } = require("./calendar");
const { getHistory, appendMessages } = require("./history");
const { logReceipt, getReceiptReport } = require("./receipts");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are "מוטי בוטי" (Moti Boti) — a witty, sharp, and highly efficient AI Family Assistant for an Israeli family (Ziv and Tal). You live inside their WhatsApp group. Your name is מוטי, and you can introduce yourself as such.

LANGUAGE: Hebrew ONLY. Never use English, even if spoken to in English.

PERSONALITY:
- Sharp, confident, slightly cheeky — like a brilliant friend who happens to know everything
- Warm underneath the wit — you genuinely care about this family
- Efficient: no fluff, no filler. Get to the point with style.
- Use dry humor and light sarcasm sparingly, never mean-spirited
- Occasional self-aware robot jokes are fine

CAPABILITIES:
1. 🛒 Grocery list — add, view, mark done, remove, clear (with confirmation)
2. 💰 Expense tracking — log purchases, monthly reports with commentary
3. 🧾 Receipt scanning — parse uploaded PDF receipts, store all line items, show trends and insights
4. 📅 Calendar invites — schedule events, send Google Calendar links
5. 🚨 Urgent DM escalation — if message starts with "דחוף", privately alert the other family member

TOOLS AVAILABLE:
- add_grocery_items: Add items to the shared list
- get_grocery_list: View the current list
- mark_item_done: Mark an item as bought
- remove_grocery_item: Remove an item
- clear_grocery_list: Clear the entire list (ONLY after explicit confirmation — always ask first)
- log_expense: Log any expense (amount + merchant, paid_by inferred from sender)
- get_expense_summary: Monthly totals per category with budget progress
- get_balance: Balance between family members — who owes whom
- get_expense_report: Detailed monthly spending report by merchant
- log_receipt: Save a fully parsed receipt with all line items (used after reading a PDF)
- get_receipt_report: Get insights from stored receipts — top items, by store, by category, savings
- send_calendar_invite: Send a calendar meeting invite by email to both Ziv and Tal

BEHAVIOR RULES:
- Always respond in Hebrew only
- Be concise and punchy — say what needs to be said, nothing more
- Use emojis sparingly: 🛒 🏪 📊 💰 ✓ • 📅 🚨
- Format grocery list: numbered, • for pending, ✓ for bought
- Format amounts with ₪ (e.g., 250 ₪)
- "ניקוי הרשימה": ALWAYS ask for confirmation first. Never clear without explicit "כן"
- ALWAYS call the log_expense tool when someone mentions a purchase or expense. Never generate the confirmation reply without calling the tool first — the tool returns the real category and monthly total.
- After the tool returns, reply in EXACTLY this format (no variations):
  ✅ רשמתי: {amount} ש"ח ב{merchant}
  📂 קטגוריה: {categoryNameHe} {categoryEmoji}
  📊 {categoryNameHe} החודש: {categoryMonthlyTotal} ש"ח
  Then add one short witty Hebrew comment about the spending.
- Expense summary: per-category totals with progress vs. budget, plus grand total. Add a one-liner observation.
- Expense reports: totals per merchant, grand total, daily average — add a one-liner observation
- You are in a group chat — everyone sees your replies
- For calendar invites: ALWAYS call send_calendar_invite tool. Never claim to send without calling the tool. Infer dates from Hebrew ("ביום שלישי" = next Tuesday, "מחר" = tomorrow). IMPORTANT: All times are Israel time (UTC+3 in summer). Always append +03:00 to start_iso and end_iso (e.g. "2026-04-15T19:00:00+03:00"). Confirm event details briefly after calling the tool.
- If a message starts with "דחוף" — treat it as urgent and note that the other family member will be privately notified

DAILY 9 PM BRIEFING STYLE (when called by the system):
- Open with a punchy one-liner about the day
- List pending grocery items (if any)
- Note today's expenses (if any logged)
- Close with a light quip about tomorrow or the family`;

const TOOLS = [
  {
    name: "add_grocery_items",
    description: "Add one or more items to the shared grocery list",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { type: "string" },
          description: "Items to add to the list",
        },
      },
      required: ["items"],
    },
  },
  {
    name: "get_grocery_list",
    description: "Retrieve the current grocery list with all items and their status",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "mark_item_done",
    description: "Mark a grocery item as bought/done",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The item name or its position number in the list",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "remove_grocery_item",
    description: "Remove an item from the grocery list entirely",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The item name or its position number in the list",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "clear_grocery_list",
    description:
      "Clear ALL items from the grocery list. Only call this after the user has explicitly confirmed (said yes/כן).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "log_expense",
    description: "Log any household expense. Auto-categorizes by merchant name. Call whenever someone mentions spending money.",
    input_schema: {
      type: "object",
      properties: {
        amount:    { type: "number", description: "Amount spent in NIS" },
        merchant:  { type: "string", description: "Merchant or store name, in Hebrew if that's how it was said" },
        paid_by:   { type: "string", description: "Name of who paid — infer from the message sender context" },
        raw_text:  { type: "string", description: "The original message text verbatim" },
      },
      required: ["amount", "merchant"],
    },
  },
  {
    name: "get_expense_summary",
    description: "Monthly spending summary with per-category totals and budget progress. Use for 'כמה הוצאנו החודש' and similar.",
    input_schema: {
      type: "object",
      properties: {
        year:  { type: "number", description: "Year, e.g. 2026. Defaults to current year." },
        month: { type: "number", description: "Month number 1-12. Defaults to current month." },
      },
      required: [],
    },
  },
  {
    name: "get_balance",
    description: "Expense balance between family members for the current month — who paid more and who owes whom.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_expense_report",
    description: "Detailed monthly expense report broken down by merchant with totals and daily average.",
    input_schema: {
      type: "object",
      properties: {
        year:  { type: "number", description: "Year, e.g. 2026" },
        month: { type: "number", description: "Month number 1-12" },
      },
      required: ["year", "month"],
    },
  },
  {
    name: "log_receipt",
    description: "Save a parsed grocery receipt to the database with all line items. Call this after extracting data from a receipt PDF.",
    input_schema: {
      type: "object",
      properties: {
        store: { type: "string", description: "Store/supermarket name in Hebrew, e.g. 'אושר עד'" },
        branch: { type: "string", description: "Branch or location, if visible" },
        date: { type: "string", description: "Purchase date in YYYY-MM-DD format" },
        time: { type: "string", description: "Purchase time, e.g. '14:32'" },
        total: { type: "number", description: "Total amount paid in NIS" },
        discount: { type: "number", description: "Total discount/savings amount in NIS" },
        paymentMethod: { type: "string", description: "Payment method, e.g. 'ויזה ****1234'" },
        receiptNumber: { type: "string", description: "Receipt or transaction number if visible" },
        items: {
          type: "array",
          description: "All line items on the receipt",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Product name in Hebrew" },
              qty: { type: "number", description: "Quantity purchased" },
              unitPrice: { type: "number", description: "Price per unit in NIS" },
              lineTotal: { type: "number", description: "Total for this line in NIS" },
              category: { type: "string", description: "Category: dairy, produce, meat, bakery, frozen, cleaning, beverages, snacks, general" },
            },
            required: ["name", "lineTotal"],
          },
        },
      },
      required: ["store", "date", "total"],
    },
  },
  {
    name: "get_receipt_report",
    description: "Get a detailed report of grocery receipts for a given month — spending by store, top purchased items, category breakdown, savings.",
    input_schema: {
      type: "object",
      properties: {
        year: { type: "number", description: "Year, e.g. 2026" },
        month: { type: "number", description: "Month number 1-12" },
      },
      required: ["year", "month"],
    },
  },
  {
    name: "send_calendar_invite",
    description: "Send a calendar meeting invite by email to both Ziv and Tal. Use this whenever someone asks to schedule a meeting, appointment, or event.",
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Event title in Hebrew, e.g. 'פגישה עם אייל'",
        },
        start_iso: {
          type: "string",
          description: "Start time in ISO 8601 format with Israel timezone offset, e.g. '2026-04-15T19:00:00+03:00'. Infer the date from context (e.g. 'Tuesday' = next Tuesday). Always append +03:00.",
        },
        end_iso: {
          type: "string",
          description: "End time in ISO 8601 format with +03:00 offset. If not specified, default to 1 hour after start.",
        },
        location: {
          type: "string",
          description: "Optional location or address",
        },
        organizer: {
          type: "string",
          description: "Name of the person organizing the meeting",
        },
      },
      required: ["title", "start_iso"],
    },
  },
];

function resolveItem(items, query) {
  const num = parseInt(query, 10);
  if (!isNaN(num)) return items[num - 1] || null;
  const q = query.toLowerCase();
  return (
    items.find((i) => i.name.toLowerCase() === q) ||
    items.find((i) => i.name.toLowerCase().includes(q)) ||
    null
  );
}

async function executeTool(toolName, input, { me }) {
  switch (toolName) {
    case "add_grocery_items": {
      for (const item of input.items) await fb.addItem(item);
      return { success: true, added: input.items };
    }

    case "get_grocery_list": {
      const items = await fb.getListArray();
      return {
        items: items.map((item, i) => ({
          number: i + 1,
          name: item.name,
          bought: item.bought,
          boughtBy: item.boughtBy || null,
        })),
        total: items.length,
        pending: items.filter((i) => !i.bought).length,
      };
    }

    case "mark_item_done": {
      const items = await fb.getListArray();
      const item = resolveItem(items, input.query);
      if (!item) return { success: false, error: "Item not found" };
      if (item.bought) return { success: false, error: "Already bought", itemName: item.name };
      await fb.markBought(item.id, me.name);
      return { success: true, itemName: item.name };
    }

    case "remove_grocery_item": {
      const items = await fb.getListArray();
      const item = resolveItem(items, input.query);
      if (!item) return { success: false, error: "Item not found" };
      await fb.removeItem(item.id);
      return { success: true, itemName: item.name };
    }

    case "clear_grocery_list": {
      await fb.clearList();
      return { success: true };
    }

    case "log_expense": {
      const expense = await expenses.logExpense(
        input.amount,
        input.merchant,
        input.paid_by || me.name,
        input.raw_text || "",
        "whatsapp_message"
      );
      const monthKey = expenses.currentMonthKey();
      const categoryTotal = await expenses.getCategoryTotal(monthKey, expense.category);
      return {
        success: true,
        expense: {
          id: expense.id,
          merchant: expense.merchant,
          amount: expense.amount,
          category: expense.category,
          subcategory: expense.subcategory,
          paid_by: expense.paid_by,
        },
        categoryNameHe:       expenses.CATEGORY_NAMES_HE[expense.category] || expense.category,
        categoryEmoji:        expenses.CATEGORY_EMOJIS[expense.category]   || "📦",
        categoryMonthlyTotal: Math.round(categoryTotal),
      };
    }

    case "get_expense_summary": {
      const now = new Date();
      const year  = input.year  || now.getFullYear();
      const month = input.month || (now.getMonth() + 1);
      const monthKey = `${year}-${String(month).padStart(2, "0")}`;
      const total = await expenses.getMonthlyTotal(monthKey);
      const topMerchants = await expenses.getTopMerchants(monthKey, 5);
      const categoryBreakdown = {};
      for (const cat of Object.keys(expenses.CATEGORY_NAMES_HE)) {
        const catTotal = await expenses.getCategoryTotal(monthKey, cat);
        if (catTotal > 0) {
          categoryBreakdown[cat] = {
            nameHe: expenses.CATEGORY_NAMES_HE[cat],
            emoji:  expenses.CATEGORY_EMOJIS[cat],
            total:  Math.round(catTotal),
          };
        }
      }
      return { monthKey, total: Math.round(total), categoryBreakdown, topMerchants };
    }

    case "get_balance": {
      return await expenses.getBalance();
    }

    case "get_expense_report": {
      return await expenses.getMonthlyReport(input.year, input.month);
    }

    case "log_receipt": {
      const today = new Date().toISOString().split("T")[0];
      const key = await logReceipt(me.name, {
        ...input,
        date: input.date || today,
      });
      return { success: true, receiptId: key, store: input.store, date: input.date || today, total: input.total, itemCount: (input.items || []).length };
    }

    case "get_receipt_report": {
      return await getReceiptReport(input.year, input.month);
    }

    case "send_calendar_invite": {
      const start = new Date(input.start_iso);
      const end = input.end_iso ? new Date(input.end_iso) : null;
      const url = buildGoogleCalendarUrl({
        title: input.title,
        start,
        end,
        location: input.location || "",
      });
      return { success: true, title: input.title, start_iso: input.start_iso, googleCalendarUrl: url };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// History is keyed by group ID (or phone for 1-on-1 fallback)
async function processMessage(text, me, historyKey) {
  const key = historyKey || me.phone;
  const history = await getHistory(key);

  const now = new Date();
  // Israel time offset: IDT (summer) = UTC+3, IST (winter) = UTC+2
  const israelOffset = "+03:00";
  const israelNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const israelDateStr = israelNow.toISOString().split("T")[0];

  const systemWithContext =
    SYSTEM_PROMPT +
    `\n\nCURRENT SENDER: ${me.name}` +
    `\nTODAY'S DATE (Israel): ${israelDateStr}` +
    `\nISRAEL TIMEZONE OFFSET: ${israelOffset} — always use this suffix on all ISO date strings for calendar invites`;

  const messages = [...history, { role: "user", content: `[${me.name}]: ${text}` }];
  let currentMessages = messages;
  let finalText = "";
  let calendarUrl = null;

  const withTimeout = (promise, ms, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)
      ),
    ]);

  // Detect calendar intent to force the tool call on first turn
  const calendarKeywords = ["זימון", "פגישה", "אירוע", "יומן", "תשלח זימון", "תקבע", "להזמין", "ארוחה", "meeting", "invite", "calendar"];
  const isCalendarIntent = calendarKeywords.some(k => text.includes(k));

  for (let i = 0; i < 10; i++) {
    const toolChoice = (i === 0 && isCalendarIntent)
      ? { type: "tool", name: "send_calendar_invite" }
      : { type: "auto" };

    const response = await withTimeout(
      client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: systemWithContext,
        tools: TOOLS,
        tool_choice: toolChoice,
        messages: currentMessages,
      }),
      30000,
      "Claude API"
    );

    if (response.stop_reason === "end_turn") {
      finalText = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
      break;
    }

    if (response.stop_reason === "tool_use") {
      currentMessages = [...currentMessages, { role: "assistant", content: response.content }];
      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        console.log(`Tool call: ${block.name}`, JSON.stringify(block.input).substring(0, 120));
        let result;
        try {
          result = await withTimeout(
            executeTool(block.name, block.input, { me }),
            20000,
            block.name
          );
        } catch (toolErr) {
          console.error(`Tool ${block.name} failed:`, toolErr.message);
          result = { success: false, error: toolErr.message };
        }
        console.log(`Tool result: ${block.name}:`, JSON.stringify(result).substring(0, 120));
        if (result.googleCalendarUrl) calendarUrl = result.googleCalendarUrl;
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
      currentMessages = [...currentMessages, { role: "user", content: toolResults }];
      continue;
    }

    break;
  }

  if (finalText) {
    await appendMessages(key, [
      { role: "user", content: `[${me.name}]: ${text}` },
      { role: "assistant", content: finalText },
    ]);
  }

  return { text: finalText || "מצטער, משהו השתבש. נסה שוב.", calendarUrl };
}

// Process an uploaded receipt PDF
async function processReceiptPdf(pdfBase64, me, historyKey) {
  const key = historyKey || me.phone;

  const now = new Date();
  const israelNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const israelDateStr = israelNow.toISOString().split("T")[0];

  const receiptSystemPrompt =
    `You are מוטי בוטי, a witty Hebrew family assistant. The user has sent you a grocery receipt PDF.
Your job:
1. Read the receipt carefully — extract store name, date, all line items (name, quantity, unit price, line total), discounts, total paid, payment method.
2. Call the log_receipt tool to save it.
3. Reply in Hebrew with a sharp, friendly summary: store, date, total, how many items, total savings if any, and one witty observation about what they bought.

TODAY'S DATE (Israel): ${israelDateStr}
CURRENT SENDER: ${me.name}

Rules:
- Hebrew only
- Be concise and punchy
- If you can't read the PDF clearly, say so in Hebrew and ask them to try again`;

  const withTimeout = (promise, ms, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)
      ),
    ]);

  const receiptTools = TOOLS.filter(t => ["log_receipt", "get_receipt_report"].includes(t.name));

  const messages = [
    {
      role: "user",
      content: [
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
        },
        {
          type: "text",
          text: `[${me.name}]: תעבד את הקבלה הזו — חלץ את כל הפרטים ושמור אותה.`,
        },
      ],
    },
  ];

  let currentMessages = messages;
  let finalText = "";

  for (let i = 0; i < 5; i++) {
    const response = await withTimeout(
      client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        system: receiptSystemPrompt,
        tools: receiptTools,
        tool_choice: i === 0 ? { type: "tool", name: "log_receipt" } : { type: "auto" },
        messages: currentMessages,
      }),
      45000,
      "Claude receipt API"
    );

    if (response.stop_reason === "end_turn") {
      finalText = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
      break;
    }

    if (response.stop_reason === "tool_use") {
      currentMessages = [...currentMessages, { role: "assistant", content: response.content }];
      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        console.log(`Receipt tool call: ${block.name}`, JSON.stringify(block.input).substring(0, 200));
        let result;
        try {
          result = await withTimeout(
            executeTool(block.name, block.input, { me }),
            20000,
            block.name
          );
        } catch (toolErr) {
          console.error(`Receipt tool ${block.name} failed:`, toolErr.message);
          result = { success: false, error: toolErr.message };
        }
        console.log(`Receipt tool result: ${block.name}:`, JSON.stringify(result).substring(0, 120));
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
      currentMessages = [...currentMessages, { role: "user", content: toolResults }];
      continue;
    }

    break;
  }

  return { text: finalText || "מצטער, לא הצלחתי לקרוא את הקבלה. נסה שוב." };
}

module.exports = { processMessage, processReceiptPdf };
