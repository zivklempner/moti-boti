const fb = require("./firebase");
const { twimlReply, replyAndNotify } = require("./twilio");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatList(items) {
  if (items.length === 0) return "Your grocery list is empty.";
  return items
    .map((item, i) => {
      const status = item.bought ? `✓ ${item.name} (bought by ${item.boughtBy})` : `• ${item.name}`;
      return `${i + 1}. ${status}`;
    })
    .join("\n");
}

/**
 * Resolve a user-supplied identifier (number or name) to an item in the list.
 * Returns the matched item or null.
 */
function resolveItem(items, query) {
  const num = parseInt(query, 10);
  if (!isNaN(num)) {
    return items[num - 1] || null;
  }
  const q = query.toLowerCase();
  return items.find((item) => item.name.toLowerCase() === q) || null;
}

// ─── Command handlers ─────────────────────────────────────────────────────────

async function handleList(res) {
  const items = await fb.getListArray();
  twimlReply(res, formatList(items));
}

async function handleAdd(res, text, me, other) {
  const rawNames = text.split(",").map((s) => s.trim()).filter(Boolean);
  const items = await fb.getListArray();
  const existingNames = items.map((i) => i.name.toLowerCase());

  const toAdd = [];
  const duplicates = [];

  for (const name of rawNames) {
    if (existingNames.includes(name.toLowerCase())) {
      duplicates.push(name);
    } else {
      toAdd.push(name);
    }
  }

  // If there are ONLY duplicates (no new items), trigger confirmation flow
  if (toAdd.length === 0 && duplicates.length > 0) {
    const list = duplicates.join(", ");
    await fb.setPending(me.phone, { type: "add_duplicates", items: duplicates });
    return twimlReply(
      res,
      `'${list}' ${duplicates.length > 1 ? "are" : "is"} already on the list — add anyway? Reply YES`
    );
  }

  // Add the non-duplicate items immediately
  for (const name of toAdd) {
    await fb.addItem(name);
  }

  let reply = `Added: ${toAdd.join(", ")} ✓`;
  let notify = `${me.name} added: ${toAdd.join(", ")}`;

  // Warn about duplicates alongside new items
  if (duplicates.length > 0) {
    const list = duplicates.join(", ");
    await fb.setPending(me.phone, { type: "add_duplicates", items: duplicates });
    reply += `\n\n'${list}' ${duplicates.length > 1 ? "are" : "is"} already on the list — add anyway? Reply YES`;
  }

  await replyAndNotify(res, reply, other?.phone, notify);
}

async function handleDone(res, args, me, other) {
  if (!args) return twimlReply(res, 'Usage: "done 2" or "done eggs"');

  const items = await fb.getListArray();
  const item = resolveItem(items, args.trim());

  if (!item) return twimlReply(res, `Item not found: "${args.trim()}"`);
  if (item.bought) return twimlReply(res, `'${item.name}' is already marked as done.`);

  await fb.markBought(item.id, me.name);

  const reply = `Marked '${item.name}' as done ✓`;
  const notify = `${me.name} marked '${item.name}' as done ✓`;
  await replyAndNotify(res, reply, other?.phone, notify);
}

async function handleRemove(res, args, me, other) {
  if (!args) return twimlReply(res, 'Usage: "remove 3" or "remove bread"');

  const items = await fb.getListArray();
  const item = resolveItem(items, args.trim());

  if (!item) return twimlReply(res, `Item not found: "${args.trim()}"`);

  await fb.removeItem(item.id);

  const reply = `Removed: ${item.name}`;
  const notify = `${me.name} removed '${item.name}' from the list`;
  await replyAndNotify(res, reply, other?.phone, notify);
}

async function handleClear(res, me) {
  await fb.setPending(me.phone, { type: "clear" });
  twimlReply(res, "Are you sure? Reply YES to clear the entire list.");
}

async function handleYes(res, me, other) {
  const pending = await fb.getPending(me.phone);
  if (!pending) return twimlReply(res, "Nothing waiting for confirmation.");

  await fb.clearPending(me.phone);

  if (pending.type === "clear") {
    await fb.clearList();
    const reply = "List cleared ✓";
    const notify = `${me.name} cleared the grocery list`;
    await replyAndNotify(res, reply, other?.phone, notify);
    return;
  }

  if (pending.type === "add_duplicates") {
    for (const name of pending.items) {
      await fb.addItem(name);
    }
    const added = pending.items.join(", ");
    const reply = `Added: ${added} ✓`;
    const notify = `${me.name} added: ${added}`;
    await replyAndNotify(res, reply, other?.phone, notify);
    return;
  }

  twimlReply(res, "Nothing waiting for confirmation.");
}

async function handleHelp(res) {
  const msg = [
    "🛒 *Grocery Bot Commands*",
    "",
    "*Add items:*  milk, eggs, bread",
    "*View list:*  list",
    "*Check off:*  done 2  _or_  done eggs",
    "*Remove:*     remove 3  _or_  remove bread",
    "*Clear all:*  clear",
    "*Help:*       help",
  ].join("\n");
  twimlReply(res, msg);
}

module.exports = {
  handleList,
  handleAdd,
  handleDone,
  handleRemove,
  handleClear,
  handleYes,
  handleHelp,
};
