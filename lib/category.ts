export const POLYMARKET_CATEGORY_ORDER = [
  "Sports",
  "Weather",
  "Politics",
  "Crypto"
] as const;

const CATEGORY_MAP: Array<{
  match: RegExp;
  category: (typeof POLYMARKET_CATEGORY_ORDER)[number];
}> = [
  {
    match: /(sport|soccer|football|basketball|baseball|hockey|tennis|golf|esport|dota|cs2|valorant|cbb|nba|wnba|nfl|nhl|mlb|epl|ncaa|uefa|fifa|ufc|mma|boxing|spread|handicap|moneyline|o\/u|over\/under| vs )/,
    category: "Sports"
  },
  { match: /(weather|temperature|rain|snow|hurricane|storm|climate)/, category: "Weather" },
  { match: /(politic|election|government|policy|senate|president|congress|vote)/, category: "Politics" },
  { match: /(crypto|bitcoin|btc|ethereum|eth|solana|sol|xrp|defi)/, category: "Crypto" }
];

function normalizeRawCategory(raw: string | null | undefined) {
  if (!raw) {
    return null;
  }

  const normalized = raw.trim().toLowerCase();

  if (normalized.length === 0) {
    return null;
  }

  for (const item of CATEGORY_MAP) {
    if (item.match.test(normalized)) {
      return item.category;
    }
  }

  return null;
}

export function resolveMarketCategoryFromTags(values: Array<string | null | undefined>) {
  for (const value of values) {
    const resolved = normalizeRawCategory(value);

    if (resolved) {
      return resolved;
    }
  }

  return null;
}
