const { getDb } = require("./firebase");

const MAX_MESSAGES = 12; // 6 exchanges of context

function phoneToKey(phone) {
  return phone.replace(/[^a-zA-Z0-9]/g, "_");
}

async function getHistory(phone) {
  const snap = await getDb()
    .ref(`moti-boti/history/${phoneToKey(phone)}`)
    .once("value");
  return snap.val() || [];
}

async function appendMessages(phone, newMessages) {
  let history = await getHistory(phone);
  history = [...history, ...newMessages];
  if (history.length > MAX_MESSAGES) {
    history = history.slice(history.length - MAX_MESSAGES);
  }
  await getDb()
    .ref(`moti-boti/history/${phoneToKey(phone)}`)
    .set(history);
}

async function clearHistory(phone) {
  await getDb()
    .ref(`moti-boti/history/${phoneToKey(phone)}`)
    .remove();
}

module.exports = { getHistory, appendMessages, clearHistory };
