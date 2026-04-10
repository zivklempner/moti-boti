const { getDb } = require("./firebase");

async function logMessage(sender, text, phone = null) {
  await getDb().ref("grocery-chat/messages").push({
    sender,
    text,
    phone: phone || null,
    timestamp: Date.now(),
  });
}

module.exports = { logMessage };
