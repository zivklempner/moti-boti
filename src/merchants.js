const Anthropic = require("@anthropic-ai/sdk");
const { getDb } = require("./firebase");

const ALLOWED_CATEGORIES = [
  "groceries", "food", "transport", "health",
  "kids", "utilities", "entertainment", "clothing", "home", "other",
];

// ─── Tier 1: Hardcoded merchant → { category, subcategory } ──────────────────

const MERCHANT_MAP = {
  // Supermarkets
  "שופרסל":        { category: "groceries",     subcategory: "supermarket" },
  "shufersal":     { category: "groceries",     subcategory: "supermarket" },
  "רמי לוי":       { category: "groceries",     subcategory: "supermarket" },
  "rami levy":     { category: "groceries",     subcategory: "supermarket" },
  "מגה":           { category: "groceries",     subcategory: "supermarket" },
  "mega":          { category: "groceries",     subcategory: "supermarket" },
  "ויקטורי":       { category: "groceries",     subcategory: "supermarket" },
  "victory":       { category: "groceries",     subcategory: "supermarket" },
  "יוחננוף":       { category: "groceries",     subcategory: "supermarket" },
  "yochananof":    { category: "groceries",     subcategory: "supermarket" },
  "קו אופ":        { category: "groceries",     subcategory: "supermarket" },
  "co-op":         { category: "groceries",     subcategory: "supermarket" },
  "סטופ מרקט":     { category: "groceries",     subcategory: "supermarket" },
  "stop market":   { category: "groceries",     subcategory: "supermarket" },
  "טיב טעם":       { category: "groceries",     subcategory: "supermarket" },
  "tiv taam":      { category: "groceries",     subcategory: "supermarket" },
  "מחסני השוק":    { category: "groceries",     subcategory: "supermarket" },
  "am:pm":         { category: "groceries",     subcategory: "convenience" },
  "חצי חינם":      { category: "groceries",     subcategory: "supermarket" },
  "hatzi hinam":   { category: "groceries",     subcategory: "supermarket" },
  "פרש מרקט":      { category: "groceries",     subcategory: "supermarket" },
  "fresh market":  { category: "groceries",     subcategory: "supermarket" },
  "אושר עד":       { category: "groceries",     subcategory: "supermarket" },
  "osher ad":      { category: "groceries",     subcategory: "supermarket" },
  "מחסן להב":      { category: "groceries",     subcategory: "warehouse" },
  "קשת טעמים":     { category: "groceries",     subcategory: "supermarket" },
  "שוק":           { category: "groceries",     subcategory: "market" },

  // Fuel
  "פז":            { category: "transport",     subcategory: "fuel" },
  "paz":           { category: "transport",     subcategory: "fuel" },
  "דלק":           { category: "transport",     subcategory: "fuel" },
  "delek":         { category: "transport",     subcategory: "fuel" },
  "סונול":         { category: "transport",     subcategory: "fuel" },
  "sonol":         { category: "transport",     subcategory: "fuel" },
  "ten":           { category: "transport",     subcategory: "fuel" },
  "טן":            { category: "transport",     subcategory: "fuel" },
  "מדלן":          { category: "transport",     subcategory: "fuel" },
  "ברקן":          { category: "transport",     subcategory: "fuel" },
  "אלון":          { category: "transport",     subcategory: "fuel" },
  "מוביל":         { category: "transport",     subcategory: "parking" },
  "קנייון":        { category: "transport",     subcategory: "parking" },

  // Pharmacies & health
  "סופר-פארם":     { category: "health",        subcategory: "pharmacy" },
  "super-pharm":   { category: "health",        subcategory: "pharmacy" },
  "super pharm":   { category: "health",        subcategory: "pharmacy" },
  "superpharm":    { category: "health",        subcategory: "pharmacy" },
  "נאות":          { category: "health",        subcategory: "pharmacy" },
  "טבע פארם":      { category: "health",        subcategory: "pharmacy" },
  "בית מרקחת":     { category: "health",        subcategory: "pharmacy" },

  // HMOs
  "כללית":         { category: "health",        subcategory: "hmo" },
  "clalit":        { category: "health",        subcategory: "hmo" },
  "מכבי":          { category: "health",        subcategory: "hmo" },
  "maccabi":       { category: "health",        subcategory: "hmo" },
  "מאוחדת":        { category: "health",        subcategory: "hmo" },
  "meuhedet":      { category: "health",        subcategory: "hmo" },
  "לאומית":        { category: "health",        subcategory: "hmo" },
  "leumit":        { category: "health",        subcategory: "hmo" },

  // Fast food & restaurants
  "מקדונלד'ס":     { category: "food",          subcategory: "fast_food" },
  "מקדונלדס":      { category: "food",          subcategory: "fast_food" },
  "mcdonalds":     { category: "food",          subcategory: "fast_food" },
  "mcdonald's":    { category: "food",          subcategory: "fast_food" },
  "kfc":           { category: "food",          subcategory: "fast_food" },
  "בורגר קינג":    { category: "food",          subcategory: "fast_food" },
  "burger king":   { category: "food",          subcategory: "fast_food" },
  "דומינוס":       { category: "food",          subcategory: "fast_food" },
  "dominos":       { category: "food",          subcategory: "fast_food" },
  "פיצה האט":      { category: "food",          subcategory: "fast_food" },
  "pizza hut":     { category: "food",          subcategory: "fast_food" },
  "שישבש":         { category: "food",          subcategory: "restaurant" },
  "ארומה":         { category: "food",          subcategory: "cafe" },
  "aroma":         { category: "food",          subcategory: "cafe" },
  "קפה קפה":       { category: "food",          subcategory: "cafe" },
  "cafe cafe":     { category: "food",          subcategory: "cafe" },
  "קפה גרג":       { category: "food",          subcategory: "cafe" },
  "greg cafe":     { category: "food",          subcategory: "cafe" },
  "coffee bean":   { category: "food",          subcategory: "cafe" },
  "סטארבקס":       { category: "food",          subcategory: "cafe" },
  "starbucks":     { category: "food",          subcategory: "cafe" },
  "דלהיה":         { category: "food",          subcategory: "bakery" },
  "לחמנינה":       { category: "food",          subcategory: "bakery" },
  "ברמן":          { category: "food",          subcategory: "bakery" },
  "נאנה":          { category: "food",          subcategory: "restaurant" },
  "תיאטרו":        { category: "food",          subcategory: "restaurant" },
  "אגאדיר":        { category: "food",          subcategory: "restaurant" },
  "הבורגר":        { category: "food",          subcategory: "fast_food" },

  // Clothing
  "זארא":          { category: "clothing",      subcategory: "fashion" },
  "zara":          { category: "clothing",      subcategory: "fashion" },
  "h&m":           { category: "clothing",      subcategory: "fashion" },
  "קסטרו":         { category: "clothing",      subcategory: "fashion" },
  "castro":        { category: "clothing",      subcategory: "fashion" },
  "פוקס":          { category: "clothing",      subcategory: "fashion" },
  "fox":           { category: "clothing",      subcategory: "fashion" },
  "רנואר":         { category: "clothing",      subcategory: "fashion" },
  "renuar":        { category: "clothing",      subcategory: "fashion" },
  "גולף":          { category: "clothing",      subcategory: "fashion" },
  "golf":          { category: "clothing",      subcategory: "fashion" },
  "נקסט":          { category: "clothing",      subcategory: "fashion" },
  "next":          { category: "clothing",      subcategory: "fashion" },
  "american eagle":{ category: "clothing",      subcategory: "fashion" },
  "adidas":        { category: "clothing",      subcategory: "sportswear" },
  "nike":          { category: "clothing",      subcategory: "sportswear" },
  "under armour":  { category: "clothing",      subcategory: "sportswear" },
  "ספורט דיפו":    { category: "clothing",      subcategory: "sportswear" },
  "sport depot":   { category: "clothing",      subcategory: "sportswear" },

  // Home & hardware
  "ikea":          { category: "home",          subcategory: "furniture" },
  "איקאה":         { category: "home",          subcategory: "furniture" },
  "ace":           { category: "home",          subcategory: "hardware" },
  "אייס":          { category: "home",          subcategory: "hardware" },
  "home center":   { category: "home",          subcategory: "hardware" },
  "הום סנטר":      { category: "home",          subcategory: "hardware" },
  "כל בו":         { category: "home",          subcategory: "general" },

  // Entertainment
  "yes planet":    { category: "entertainment", subcategory: "cinema" },
  "יס פלנט":       { category: "entertainment", subcategory: "cinema" },
  "סינמה סיטי":    { category: "entertainment", subcategory: "cinema" },
  "cinema city":   { category: "entertainment", subcategory: "cinema" },
  "נטפליקס":       { category: "entertainment", subcategory: "streaming" },
  "netflix":       { category: "entertainment", subcategory: "streaming" },
  "ספוטיפיי":      { category: "entertainment", subcategory: "streaming" },
  "spotify":       { category: "entertainment", subcategory: "streaming" },
  "הוט":           { category: "entertainment", subcategory: "streaming" },
  "yes":           { category: "entertainment", subcategory: "streaming" },

  // Utilities & telecom
  "בזק":           { category: "utilities",     subcategory: "telecom" },
  "bezeq":         { category: "utilities",     subcategory: "telecom" },
  "hot mobile":    { category: "utilities",     subcategory: "mobile" },
  "012":           { category: "utilities",     subcategory: "telecom" },
  "ועד בית":       { category: "utilities",     subcategory: "building" },
  "סלקום":         { category: "utilities",     subcategory: "mobile" },
  "cellcom":       { category: "utilities",     subcategory: "mobile" },
  "פרטנר":         { category: "utilities",     subcategory: "mobile" },
  "partner":       { category: "utilities",     subcategory: "mobile" },
  "גז":            { category: "utilities",     subcategory: "gas" },
  "חשמל":          { category: "utilities",     subcategory: "electricity" },
  "מים":           { category: "utilities",     subcategory: "water" },
  "עיריית":        { category: "utilities",     subcategory: "municipality" },
  "arnona":        { category: "utilities",     subcategory: "municipality" },
  "ארנונה":        { category: "utilities",     subcategory: "municipality" },

  // Kids
  "toys r us":     { category: "kids",          subcategory: "toys" },
  "טויס אר אס":    { category: "kids",          subcategory: "toys" },
  "kiddo":         { category: "kids",          subcategory: "toys" },
  "תמנון":         { category: "kids",          subcategory: "toys" },
  "tamnun":        { category: "kids",          subcategory: "toys" },
  "ממגנטים":       { category: "kids",          subcategory: "education" },
  "צעצועי עולם":   { category: "kids",          subcategory: "toys" },
};

// ─── Lazy Anthropic client ────────────────────────────────────────────────────

let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

// ─── Tier 3: Claude fallback + Firebase cache ─────────────────────────────────

async function claudeCategorize(merchantName) {
  const cacheKey = merchantName.replace(/[.#$[\]/]/g, "_");
  const cacheRef = getDb().ref(`merchant_cache/${cacheKey}`);
  const cached = (await cacheRef.once("value")).val();
  if (cached) return cached;

  try {
    const response = await getClient().messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 64,
      messages: [
        {
          role: "user",
          content:
            `Categorize this Israeli merchant into one of these categories: ${ALLOWED_CATEGORIES.join(", ")}.\n` +
            `Merchant: "${merchantName}"\n` +
            `Reply with a JSON object only: {"category": "...", "subcategory": "..."}`,
        },
      ],
    });

    const text = response.content.find((b) => b.type === "text")?.text || "{}";
    const match = text.match(/\{[^}]+\}/);
    const parsed = match ? JSON.parse(match[0]) : null;

    if (parsed && ALLOWED_CATEGORIES.includes(parsed.category)) {
      await cacheRef.set(parsed);
      return parsed;
    }
  } catch (err) {
    console.error(`claudeCategorize failed for "${merchantName}":`, err.message);
  }

  return { category: "other", subcategory: "general" };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Resolves a merchant name to { category, subcategory }.
 * Tier 1: exact match in hardcoded map (case-insensitive).
 * Tier 2: fuzzy substring match against all map keys.
 * Tier 3: Claude API call with Firebase result cache.
 *
 * @param {string} merchantName
 * @returns {Promise<{ category: string, subcategory: string }>}
 */
async function resolveCategory(merchantName) {
  if (!merchantName) return { category: "other", subcategory: "general" };

  const normalized = merchantName.trim().toLowerCase();

  // Tier 1 — exact match
  if (MERCHANT_MAP[normalized]) return MERCHANT_MAP[normalized];

  // Tier 2 — fuzzy: any key that includes or is included in the name
  for (const [key, value] of Object.entries(MERCHANT_MAP)) {
    if (normalized.includes(key) || key.includes(normalized)) return value;
  }

  // Tier 3 — Claude with Firebase cache
  return claudeCategorize(merchantName);
}

module.exports = { resolveCategory, ALLOWED_CATEGORIES };
