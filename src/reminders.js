const { v4: uuidv4 } = require("uuid");
const { getDb } = require("./firebase");

/**
 * Save a new reminder to Firebase.
 * @param {object} opts
 * @param {string} opts.text         - Reminder text to send
 * @param {string} opts.scheduledIso - ISO 8601 datetime with TZ offset
 * @param {string} opts.createdBy    - Name of the person who set the reminder
 * @param {string} opts.groupId      - WhatsApp group ID to send to
 * @returns {Promise<object>} Saved reminder
 */
async function saveReminder({ text, scheduledIso, createdBy, groupId }) {
  const id = uuidv4();
  const reminder = {
    id,
    text,
    scheduled_iso: scheduledIso,
    created_by:    createdBy,
    group_id:      groupId,
    sent:          false,
    created_at:    new Date().toISOString(),
  };
  await getDb().ref(`reminders/${id}`).set(reminder);
  return reminder;
}

/**
 * Fetch all unsent reminders whose scheduled time has passed.
 * @returns {Promise<object[]>}
 */
async function getDueReminders() {
  const snap = await getDb()
    .ref("reminders")
    .orderByChild("sent")
    .equalTo(false)
    .once("value");

  const now = new Date();
  return Object.values(snap.val() || {}).filter(
    (r) => new Date(r.scheduled_iso) <= now
  );
}

/**
 * Mark a reminder as sent so it won't fire again.
 * @param {string} id
 */
async function markReminderSent(id) {
  await getDb().ref(`reminders/${id}/sent`).set(true);
}

module.exports = { saveReminder, getDueReminders, markReminderSent };
