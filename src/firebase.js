const admin = require("firebase-admin");

let db;

function initFirebase() {
  if (admin.apps.length) return;

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Railway/Render store env vars as single-line; restore newlines
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });

  db = admin.database();
}

function getDb() {
  if (!db) initFirebase();
  return db;
}

// ─── List operations ──────────────────────────────────────────────────────────

async function getList() {
  const snap = await getDb().ref("grocery/items").once("value");
  return snap.val() || {};
}

/**
 * Returns items as a sorted array: [{ id, name, bought, boughtBy }, ...]
 * Sorted by insertion order (Firebase key = timestamp-based push ID).
 */
async function getListArray() {
  const items = await getList();
  return Object.entries(items)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([id, data]) => ({ id, ...data }));
}

async function addItem(name) {
  const ref = getDb().ref("grocery/items").push();
  await ref.set({ name, bought: false, boughtBy: null, addedAt: Date.now() });
  return ref.key;
}

async function markBought(id, buyerName) {
  await getDb().ref(`grocery/items/${id}`).update({
    bought: true,
    boughtBy: buyerName,
    boughtAt: Date.now(),
  });
}

async function removeItem(id) {
  await getDb().ref(`grocery/items/${id}`).remove();
}

async function clearList() {
  await getDb().ref("grocery/items").remove();
}

// ─── Pending-confirmation state ───────────────────────────────────────────────
// Stored in Firebase so it survives server restarts and works across instances.

async function setPending(phone, data) {
  const key = phone.replace(/\+/g, "_plus_").replace(/:/g, "_colon_");
  await getDb()
    .ref(`grocery/pending/${key}`)
    .set({ ...data, expiresAt: Date.now() + 60_000 });
}

async function getPending(phone) {
  const key = phone.replace(/\+/g, "_plus_").replace(/:/g, "_colon_");
  const snap = await getDb().ref(`grocery/pending/${key}`).once("value");
  const data = snap.val();
  if (!data) return null;
  if (data.expiresAt < Date.now()) {
    await clearPending(phone);
    return null;
  }
  return data;
}

async function clearPending(phone) {
  const key = phone.replace(/\+/g, "_plus_").replace(/:/g, "_colon_");
  await getDb().ref(`grocery/pending/${key}`).remove();
}

module.exports = {
  initFirebase,
  getDb,
  getList,
  getListArray,
  addItem,
  markBought,
  removeItem,
  clearList,
  setPending,
  getPending,
  clearPending,
};
