/**
 * prices.js
 * Wrapper around chp.co.il price comparison API.
 * Converted from ES module to CommonJS; zero extra dependencies.
 *
 * Main export:
 *   compareProductPrices(product, city) → { product, manufacturer, barcode, priceRange, chains }
 *
 * `chains` is an array of up to 8 cheapest unique supermarket chains (one entry per chain,
 *  using the cheapest branch in that city), sorted cheapest-first.
 */

"use strict";

// ── Constants ──────────────────────────────────────────────────────────────────

const BASE_URL   = "https://chp.co.il";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const HEADERS = {
  "User-Agent":      USER_AGENT,
  Accept:            "application/json, text/javascript, */*; q=0.01",
  "X-Requested-With": "XMLHttpRequest",
  Referer:           `${BASE_URL}/`,
  "Accept-Language": "he,en-US;q=0.9,en;q=0.8",
};

// ── Low-level API ──────────────────────────────────────────────────────────────

async function resolveAddress(address) {
  const params = new URLSearchParams({
    term: address, from: "0", u: String(Math.random()),
  });
  const res = await fetch(`${BASE_URL}/autocompletion/shopping_address?${params}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Address lookup failed: ${res.status}`);
  const data = await res.json();
  return data.map((item) => {
    const [city_id, street_id] = (item.id || "0_0").split("_");
    return { value: item.value, label: item.label, city_id, street_id };
  });
}

async function searchProducts(term, city = "", cityId = "0", streetId = "0") {
  const params = new URLSearchParams({
    term, from: "0", u: String(Math.random()),
    shopping_address: city,
    shopping_address_city_id: cityId,
    shopping_address_street_id: streetId,
  });
  const res = await fetch(`${BASE_URL}/autocompletion/product_extended?${params}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Product search failed: ${res.status}`);
  const data = await res.json();
  return data.map((item) => {
    const parts = item.parts || {};
    const barcodeMatch = (parts.manufacturer_and_barcode || "").match(/ברקוד:\s*(\d+)/);
    const mfgMatch     = (parts.manufacturer_and_barcode || "").match(/יצרן\/מותג:\s*([^,]+)/);
    return {
      name:         parts.name_and_contents || item.value,
      manufacturer: mfgMatch    ? mfgMatch[1].trim()    : "",
      barcode:      barcodeMatch ? barcodeMatch[1]       : "",
      id:           item.id,
      priceRange:   parts.price_range || [],
    };
  });
}

async function comparePrices(productBarcode, productName, city = "", cityId = "0", streetId = "0", numResults = 50) {
  const params = new URLSearchParams({
    shopping_address:            city,
    shopping_address_street_id:  streetId,
    shopping_address_city_id:    cityId,
    product_name_or_barcode:     productName,
    product_barcode:             productBarcode,
    from:                        "0",
    num_results:                 String(numResults),
  });
  const res = await fetch(`${BASE_URL}/main_page/compare_results?${params}`, {
    headers: { ...HEADERS, Accept: "*/*" },
  });
  if (!res.ok) throw new Error(`Compare failed: ${res.status}`);
  const html = await res.text();
  return parseCompareResults(html);
}

// ── High-level helper ──────────────────────────────────────────────────────────

/**
 * Compare prices for a product across supermarket chains in a given city.
 * Returns the top 8 cheapest unique chains (cheapest branch per chain).
 *
 * @param {string} product  - Product name (Hebrew) or barcode
 * @param {string} city     - City name in Hebrew (e.g. "תל אביב")
 * @returns {{ product, manufacturer, barcode, priceRange, chains, notFound }}
 */
async function compareProductPrices(product, city) {
  if (!city) city = process.env.DEFAULT_CITY || "תל אביב";

  // Resolve city → IDs
  let cityId = "0", streetId = "0";
  const addresses = await resolveAddress(city);
  if (addresses.length > 0) {
    cityId   = addresses[0].city_id;
    streetId = addresses[0].street_id;
  }

  // Find best matching product
  const products = await searchProducts(product, city, cityId, streetId);
  if (products.length === 0) {
    return { notFound: true, product };
  }
  const best = products[0];

  // Get full price comparison
  const comparison = await comparePrices(best.id, product, city, cityId, streetId, 60);

  // Deduplicate by chain — keep cheapest effective price per chain
  const chainMap = new Map();
  for (const store of comparison.stores) {
    const effectivePrice = parseFloat(store.salePrice || store.price) || Infinity;
    const existing = chainMap.get(store.chain);
    if (!existing || effectivePrice < existing.effectivePrice) {
      chainMap.set(store.chain, { ...store, effectivePrice });
    }
  }

  // Sort chains cheapest-first and take top 8
  const chains = Array.from(chainMap.values())
    .sort((a, b) => a.effectivePrice - b.effectivePrice)
    .slice(0, 8)
    .map(({ effectivePrice: _, ...rest }) => rest);

  return {
    product:      best.name,
    manufacturer: best.manufacturer,
    barcode:      best.barcode,
    priceRange:   best.priceRange,
    city,
    chains,
  };
}

module.exports = { compareProductPrices };

// ── HTML parsing (internal) ────────────────────────────────────────────────────

function parseCompareResults(html) {
  const root = simpleHtmlParse(html);
  const productInput = root.querySelector("#displayed_product_name_and_contents");
  const productName  = productInput ? productInput.getAttribute("value") : "";
  const stores = [];
  for (const table of root.querySelectorAll("table")) {
    for (const row of table.querySelectorAll("tr")) {
      const cells = row.querySelectorAll("td");
      if (cells.length >= 5) {
        const chain   = cells[0].text.trim();
        const store   = cells[1].text.trim();
        const address = cells[2].text.trim();
        const saleButton    = cells[3].querySelector("button");
        const salePrice     = saleButton ? saleButton.text.replace("*", "").trim() : null;
        const regularPrice  = cells[4].text.trim();
        let saleConditions  = null;
        if (saleButton) {
          const rawDesc = saleButton.getAttribute("data-discount-desc");
          if (rawDesc) {
            saleConditions = rawDesc
              .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"').replace(/&amp;/g, "&")
              .replace(/<BR\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "")
              .trim();
          }
        }
        if (chain && (regularPrice || salePrice)) {
          stores.push({ chain, store, address, price: regularPrice || salePrice, salePrice: salePrice || null, saleConditions: saleConditions || null });
        }
      }
    }
  }
  return { product: productName, stores };
}

function simpleHtmlParse(html) {
  return {
    querySelector(selector) {
      if (selector.startsWith("#")) {
        const id = selector.slice(1);
        const match = html.match(new RegExp(`<input[^>]*id=["']${id}["'][^>]*>`, "i"));
        if (match) {
          return { getAttribute(attr) { const m = match[0].match(new RegExp(`${attr}=["']([^"']*)["']`, "i")); return m ? m[1] : null; } };
        }
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector !== "table") return [];
      const tables = []; const re = /<table[^>]*>([\s\S]*?)<\/table>/gi; let m;
      while ((m = re.exec(html)) !== null) tables.push(_createTableElement(m[0]));
      return tables;
    },
  };
}

function _createTableElement(html) {
  return {
    querySelectorAll(selector) {
      if (selector !== "tr") return [];
      const rows = []; const re = /<tr[^>]*>([\s\S]*?)<\/tr>/gi; let m;
      while ((m = re.exec(html)) !== null) rows.push(_createRowElement(m[0]));
      return rows;
    },
  };
}

function _createRowElement(html) {
  return {
    querySelectorAll(selector) {
      if (selector !== "td") return [];
      const cells = []; const re = /<td[^>]*>([\s\S]*?)<\/td>/gi; let m;
      while ((m = re.exec(html)) !== null) cells.push(_createCellElement(m[1]));
      return cells;
    },
  };
}

function _createCellElement(html) {
  return {
    get text() { return html.replace(/<[^>]*>/g, "").trim(); },
    querySelector(selector) {
      if (selector !== "button") return null;
      const m = html.match(/<button[^>]*>([\s\S]*?)<\/button>/i);
      if (!m) return null;
      const tag = m[0];
      return {
        get text() { return m[1].replace(/<[^>]*>/g, "").trim(); },
        getAttribute(attr) {
          const dm = tag.match(new RegExp(`${attr}="([^"]*)"`,"i")); if (dm) return dm[1];
          const sm = tag.match(new RegExp(`${attr}='([^']*)'`,"i")); if (sm) return sm[1];
          return null;
        },
      };
    },
  };
}
