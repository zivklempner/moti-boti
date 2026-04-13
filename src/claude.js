const Anthropic = require("@anthropic-ai/sdk");
const fb = require("./firebase");
const expenses = require("./expenses");
const { buildGoogleCalendarUrl } = require("./calendar");
const { getHistory, appendMessages } = require("./history");
const { logReceipt, getReceiptReport } = require("./receipts");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `אתה מוטי — הבוט של המשפחה בוואטסאפ. אתה עוזר לזיו (גבר) ולטל (אישה) עם קניות, הוצאות, אירועים ויומן.
זיו — גבר. פנייה אליו: אתה, קנית, שילמת וכו'.
טל — אישה. פנייה אליה: את, קנית, שילמת וכו' (בנטייה נקבה).

שפה: עברית בלבד. תמיד. גם אם פונים אליך באנגלית — עונה בעברית.

אופי:
- כותב כמו חבר בוואטסאפ — קצר, ישיר, ידידותי
- לא פורמלי, אבל גם לא מנסה להיות מצחיק — פשוט עוזר
- אין בדיחות, אין הערות "חכמות" בסוף הודעה, אין ציניות
- אמוג'י — מעט ובמינון. רק כשזה מוסיף משהו
- לא מסיים תשובות עם "אם יש לך שאלות..." וכאלה — פשוט עונה ונגמר

כלים זמינים:
- add_grocery_items: להוסיף פריטים לרשימה
- get_grocery_list: לראות את הרשימה
- mark_item_done: לסמן פריט כנקנה
- remove_grocery_item: למחוק פריט
- clear_grocery_list: לנקות את כל הרשימה (רק אחרי אישור מפורש!)
- log_expense: לרשום הוצאה
- get_expense_summary: סיכום הוצאות לפי קטגוריה
- get_balance: מי חייב למי ולמה
- get_expense_report: דוח מפורט לפי חנות
- log_receipt: שמירת קבלה מ-PDF
- get_receipt_report: תובנות מקבלות שנשמרו
- send_calendar_invite: שליחת זימון ליומן גוגל
- find_events: חיפוש הופעות, קונצרטים, סטנדאפ לפי תאריכים

קלט נתמך: הודעות טקסט, הודעות קוליות (מתומלל אוטומטית), תמונות קבלה, PDF קבלה.

כללים חשובים:
- כשמדברים על קנייה או הוצאה — ALWAYS קרא ל-log_expense. אל תמציא את התוצאה. הכלי מחזיר את הקטגוריה והסכום החודשי האמיתי.
- אם מציינים תאריך יחסי ("אתמול", "שלשום", "לפני שבוע") — חשב את התאריך האמיתי בפורמט YYYY-MM-DD על פי TODAY'S DATE שבקונטקסט, ושלח אותו כ-date ב-log_expense. אם לא מציינים תאריך — אל תשלח date (ייווצר אוטומטית כהיום).
- אחרי log_expense, ענה בדיוק בפורמט הזה:
  ✅ רשמתי: {amount} ₪ ב{merchant}
  📂 {categoryNameHe} {categoryEmoji}
  📊 {categoryNameHe} החודש: {categoryMonthlyTotal} ₪
  זהו. לא להוסיף הערות, בדיחות, או משפטים נוספים.
- "ניקוי הרשימה": תמיד לשאול קודם. בלי אישור מפורש — לא מוחקים כלום.
- לזימון יומן — ALWAYS קרא ל-send_calendar_invite. אל תגיד שזימנת בלי לקרוא לכלי. כל התאריכים בשעון ישראל (+03:00).
- לחיפוש אירועים — ALWAYS קרא ל-find_events. אל תמציא הופעות. הצג את התוצאות בפורמט ברור עם תאריך, שעה ומיקום. אם אין תוצאות — תגיד את זה ישר. הצע לקבוע תזכורת לאירועים שמעניינים אותם.
- אם ההודעה מתחילה ב"דחוף" — זה אורגנטי, הצד השני יקבל התראה פרטית.

סגנון הבריפינג היומי (21:00):
- פתח עם משפט אחד שמסכם את היום — לא בנאלי
- פריטים שעדיין לא נקנו
- הוצאות היום אם יש
- סיום קצר וידידותי`;



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
        date:      { type: "string", description: "Date of the expense in YYYY-MM-DD format. Use today's date unless the message mentions a different date (e.g. 'yesterday', 'אתמול', 'שלשום'). Always resolve relative dates to absolute dates using TODAY'S DATE from context." },
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
  {
    name: "find_events",
    description: "Search for shows, concerts, standup comedy, or theater events based on the user's available dates and preferences. Use when someone asks about events, shows, or what's on.",
    input_schema: {
      type: "object",
      properties: {
        days_of_week: {
          type: "array",
          items: { type: "number" },
          description: "Days of week as numbers: 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday",
        },
        date_from: { type: "string", description: "Start date YYYY-MM-DD" },
        date_to:   { type: "string", description: "End date YYYY-MM-DD" },
        time_from: { type: "string", description: "Earliest show start time HH:MM, e.g. '20:00'" },
        city:      { type: "string", description: "City or area filter in Hebrew, e.g. 'תל אביב', 'מרכז'" },
        artists:   { type: "array", items: { type: "string" }, description: "Specific artist names if mentioned" },
      },
      required: [],
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
        "whatsapp_message",
        input.date || null
      );
      const monthKey = input.date
        ? input.date.substring(0, 7)
        : expenses.currentMonthKey();
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

    case "find_events": {
      const { searchEventsByAvailability } = require("./services/events");
      const rows = await searchEventsByAvailability({
        days_of_week: input.days_of_week,
        date_from:    input.date_from,
        date_to:      input.date_to,
        time_from:    input.time_from,
        city:         input.city,
        artists:      input.artists,
        limit:        5,
      });
      return { count: rows.length, events: rows };
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

  const FEMALE_NAMES = ["טל", "tal"];
  const senderIsFemale = FEMALE_NAMES.includes((me.name || "").toLowerCase().trim());
  const genderNote = senderIsFemale
    ? "טל שולחת — פני אליה בלשון נקבה (את, קנית, שילמת, יש לך, וכו׳)"
    : "זיו שולח — פנה אליו בלשון זכר (אתה, קנית, שילמת, יש לך, וכו׳)";

  const systemWithContext =
    SYSTEM_PROMPT +
    `\n\nSENDER: ${me.name} — ${genderNote}` +
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
  const calendarKeywords = ["זימון", "פגישה", "יומן", "תשלח זימון", "תקבע", "להזמין", "meeting", "invite", "calendar"];
  const isCalendarIntent = calendarKeywords.some(k => text.includes(k));

  // Detect expense intent — any message with a number + currency marker
  const isExpenseIntent = !isCalendarIntent && /\d+\s*(₪|ש"ח|שח|שקל)/i.test(text);

  // Detect event search intent — show/concert keywords or day availability patterns
  const eventKeywords = ["הופעה", "קונצרט", "סטנדאפ", "הצגה", "שואו", "כרטיסים", "ימי שני", "ימי שלישי", "ימי רביעי", "ימי חמישי", "ימי שישי", "מה יש לעשות", "להיות פנויים", "מה קורה", "אירועים"];
  const isEventsIntent = !isCalendarIntent && !isExpenseIntent && eventKeywords.some(k => text.includes(k));

  for (let i = 0; i < 10; i++) {
    const toolChoice = (i === 0 && isCalendarIntent)
      ? { type: "tool", name: "send_calendar_invite" }
      : (i === 0 && isExpenseIntent)
      ? { type: "tool", name: "log_expense" }
      : (i === 0 && isEventsIntent)
      ? { type: "tool", name: "find_events" }
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

// Process an uploaded receipt image (JPEG/PNG) via Claude vision
async function processReceiptImage(base64Data, mimeType, me) {
  const now = new Date();
  const israelNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const israelDateStr = israelNow.toISOString().split("T")[0];

  const withTimeout = (promise, ms, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)
      ),
    ]);

  // Normalise mime type — WhatsApp may send "image/jpeg" or "image/png"
  const validMimes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  const safeMime = validMimes.includes(mimeType) ? mimeType : "image/jpeg";

  let response;
  try {
    response = await withTimeout(
      client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: safeMime, data: base64Data },
              },
              {
                type: "text",
                text:
                  `זוהי קבלה. חלץ ממנה בדיוק שלושה שדות:\n` +
                  `1. שם העסק/חנות (merchant)\n` +
                  `2. הסכום הכולל לתשלום בשקלים (amount) — המספר הסופי/הגדול ביותר\n` +
                  `3. תאריך הקנייה (date) בפורמט YYYY-MM-DD — היום הוא ${israelDateStr}\n\n` +
                  `ענה ב-JSON בלבד, ללא כל טקסט נוסף:\n` +
                  `{"merchant":"שם","amount":123.45,"date":"YYYY-MM-DD"}\n\n` +
                  `אם לא ניתן לקרוא שדה מסוים — השתמש ב-null.`,
              },
            ],
          },
        ],
      }),
      30000,
      "Claude vision"
    );
  } catch (err) {
    console.error("processReceiptImage vision call failed:", err.message);
    return { text: "לא הצלחתי לקרוא את הקבלה. נסה לצלם שוב — וודא שהטקסט ברור ובפוקוס." };
  }

  const rawText = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  let extracted = {};
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*?\}/);
    if (jsonMatch) extracted = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("Receipt image JSON parse failed:", e.message, rawText);
  }

  console.log("Receipt image extracted:", JSON.stringify(extracted));

  if (!extracted.merchant || !extracted.amount) {
    return { text: "לא הצלחתי לזהות את פרטי הקבלה. נסה לצלם שוב בתאורה טובה יותר." };
  }

  const expense = await expenses.logExpense(
    extracted.amount,
    extracted.merchant,
    me.name,
    "[קבלה תמונה]",
    "receipt_image",
    extracted.date || null
  );

  const monthKey = extracted.date
    ? extracted.date.substring(0, 7)
    : expenses.currentMonthKey();
  const categoryTotal = await expenses.getCategoryTotal(monthKey, expense.category);

  const catHe    = expenses.CATEGORY_NAMES_HE[expense.category] || expense.category;
  const catEmoji = expenses.CATEGORY_EMOJIS[expense.category]   || "📦";

  return {
    text:
      `✅ רשמתי: ${expense.amount} ₪ ב${expense.merchant}` +
      (extracted.date ? ` (${extracted.date})` : "") +
      `\n📂 ${catHe} ${catEmoji}` +
      `\n📊 ${catHe} החודש: ${Math.round(categoryTotal)} ₪`,
  };
}

module.exports = { processMessage, processReceiptPdf, processReceiptImage };
