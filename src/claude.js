const Anthropic = require("@anthropic-ai/sdk");
const fb = require("./firebase");
const expenses = require("./expenses");
const { buildGoogleCalendarUrl } = require("./calendar");
const { getHistory, appendMessages } = require("./history");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a WhatsApp grocery assistant bot for an Israeli family. You MUST respond ONLY in Hebrew (עברית). Never use English in your responses, even if the user writes in English.

You help with three things:
1. Managing a shared grocery list (shared between all family members in real time)
2. Tracking grocery purchases and expenses by store, with monthly reports
3. Sending calendar meeting invites to the family (Ziv and Tal) via email

TOOLS AVAILABLE:
- add_grocery_items: Add items to the shared list
- get_grocery_list: View the current list
- mark_item_done: Mark an item as bought
- remove_grocery_item: Remove an item
- clear_grocery_list: Clear the entire list (ONLY after the user explicitly confirms — always ask first)
- log_expense: Log a grocery purchase (store name + amount in NIS)
- get_expense_report: Get monthly spending report by store
- send_calendar_invite: Send a calendar meeting invite by email to both Ziv and Tal

BEHAVIOR RULES:
- Always respond in Hebrew only
- Be warm, friendly and concise
- Use emojis sparingly: 🛒 🏪 📊 💰 ✓ •
- Format grocery list as numbered list with • for pending items and ✓ for bought items
- Format amounts with ₪ symbol (e.g., 250 ₪)
- For "clear list": ALWAYS ask for confirmation first, never clear without explicit "כן" from the user
- When logging an expense, confirm back with the store name and amount
- For expense reports: show totals per store, grand total, and daily average
- You are in a group chat — all family members see your replies, no need to notify anyone separately
- For calendar invites: infer dates from Hebrew context (e.g. "ביום שלישי" = next Tuesday, "מחר" = tomorrow). After the tool returns, include the googleCalendarUrl link in your reply so users can tap it to add the event to their calendar.`;

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
    description: "Log a grocery purchase expense to the expense tracker",
    input_schema: {
      type: "object",
      properties: {
        store: { type: "string", description: "Store or supermarket name" },
        amount: { type: "number", description: "Amount spent in NIS (numbers only)" },
        date: {
          type: "string",
          description: "Purchase date in YYYY-MM-DD format. Use today if not specified.",
        },
        category: {
          type: "string",
          description: "Optional category: dairy, produce, meat, bakery, general, etc.",
        },
      },
      required: ["store", "amount", "date"],
    },
  },
  {
    name: "get_expense_report",
    description: "Get monthly expense report showing spending broken down by store",
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
          description: "Start time in ISO 8601 format, e.g. '2026-04-15T19:00:00'. Infer the date from context (e.g. 'Tuesday' = next Tuesday). Use Israel timezone (UTC+3).",
        },
        end_iso: {
          type: "string",
          description: "End time in ISO 8601 format. If not specified, default to 1 hour after start.",
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
      const today = new Date().toISOString().split("T")[0];
      await expenses.logExpense(me.name, {
        store: input.store,
        amount: input.amount,
        date: input.date || today,
        category: input.category || "general",
      });
      return { success: true, store: input.store, amount: input.amount, date: input.date || today };
    }

    case "get_expense_report": {
      return await expenses.getMonthlyReport(input.year, input.month);
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
      // Store URL so processMessage can return it to the caller
      pendingCalendarUrl = url;
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
  const systemWithContext =
    SYSTEM_PROMPT +
    `\n\nCURRENT SENDER: ${me.name}` +
    `\nTODAY'S DATE: ${now.toISOString().split("T")[0]}`;

  const messages = [...history, { role: "user", content: `[${me.name}]: ${text}` }];
  let currentMessages = messages;
  let finalText = "";
  let pendingCalendarUrl = null;

  const withTimeout = (promise, ms, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)
      ),
    ]);

  for (let i = 0; i < 10; i++) {
    const response = await withTimeout(
      client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: systemWithContext,
        tools: TOOLS,
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

  return { text: finalText || "מצטער, משהו השתבש. נסה שוב.", calendarUrl: pendingCalendarUrl };
}

module.exports = { processMessage };
