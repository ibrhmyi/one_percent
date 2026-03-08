import type {
  MarketSort,
  MarketBadge,
  MarketQuery,
  NormalizedMarket
} from "@/lib/types";

export function getDisplayVolume(market: NormalizedMarket) {
  return market.eventVolume ?? market.volume;
}

function normalizeProbability(value: number | null) {
  if (value === null) {
    return null;
  }

  return value > 1 ? value / 100 : value;
}

function satisfiesYesPriceFloor(market: NormalizedMarket, minYesPrice: number | null | undefined) {
  if (minYesPrice === null || minYesPrice === undefined) {
    return true;
  }

  const yesPrice = normalizeProbability(market.yesPrice);

  if (yesPrice === null) {
    return false;
  }

  return yesPrice > minYesPrice;
}

function satisfiesNoPriceFloor(market: NormalizedMarket, minNoPrice: number | null | undefined) {
  if (minNoPrice === null || minNoPrice === undefined) {
    return true;
  }

  const noPrice = normalizeProbability(market.noPrice);

  if (noPrice === null) {
    return false;
  }

  return noPrice > minNoPrice;
}

function compareNullableNumberDesc(left: number | null, right: number | null) {
  if (left === null && right === null) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return right - left;
}

export function getHoursUntilClose(market: NormalizedMarket) {
  const closeTime = new Date(market.closeTime).getTime();
  return (closeTime - Date.now()) / (1000 * 60 * 60);
}

function getClosingBucketRank(market: NormalizedMarket) {
  const hoursUntilClose = getHoursUntilClose(market);

  if (hoursUntilClose <= 10 / 60) {
    return 0;
  }

  if (hoursUntilClose <= 30 / 60) {
    return 1;
  }

  if (hoursUntilClose <= 1) {
    return 2;
  }

  return 3;
}

function normalizedNoPrice(market: NormalizedMarket) {
  return normalizeProbability(market.noPrice);
}

function matchesTimeWindow(market: NormalizedMarket, query: MarketQuery) {
  const hasLiveFilter = query.onlyLive === true;
  const hasClosingWindow =
    query.maxHours !== null && query.maxHours !== undefined;
  const maxHours =
    typeof query.maxHours === "number" ? query.maxHours : null;
  const hoursUntilClose = getHoursUntilClose(market);
  const withinClosingWindow =
    maxHours !== null ? hoursUntilClose >= 0 && hoursUntilClose <= maxHours : false;

  if (hasLiveFilter && hasClosingWindow) {
    return market.isLive === true || withinClosingWindow;
  }

  if (hasLiveFilter) {
    return market.isLive === true;
  }

  if (hasClosingWindow) {
    return withinClosingWindow;
  }

  return true;
}

export function getMarketBadge(market: NormalizedMarket): MarketBadge {
  const hoursUntilClose = getHoursUntilClose(market);

  if (hoursUntilClose <= 24) {
    return "Closing Soon";
  }

  const missingData =
    market.yesPrice === null &&
    market.noPrice === null &&
    market.liquidity === null &&
    market.volume === null;

  if (missingData) {
    return "Missing data";
  }

  return "Active";
}

export function sortMarkets(markets: NormalizedMarket[], sort: MarketSort = "soonest") {
  const sorted = [...markets];

  sorted.sort((left, right) => {
    if (sort === "urgency") {
      const rankDelta = getClosingBucketRank(left) - getClosingBucketRank(right);

      if (rankDelta !== 0) {
        return rankDelta;
      }

      const noPriceDelta = compareNullableNumberDesc(
        normalizedNoPrice(left),
        normalizedNoPrice(right)
      );

      if (noPriceDelta !== 0) {
        return noPriceDelta;
      }

      return new Date(left.closeTime).getTime() - new Date(right.closeTime).getTime();
    }

    if (sort === "signal") {
      const leftMid = left.resolutionWindowMin != null && left.resolutionWindowMax != null
        ? (left.resolutionWindowMin + left.resolutionWindowMax) / 2
        : Infinity;
      const rightMid = right.resolutionWindowMin != null && right.resolutionWindowMax != null
        ? (right.resolutionWindowMin + right.resolutionWindowMax) / 2
        : Infinity;

      if (leftMid !== rightMid) {
        return leftMid - rightMid;
      }

      const noPriceDelta = compareNullableNumberDesc(
        normalizedNoPrice(left),
        normalizedNoPrice(right)
      );

      if (noPriceDelta !== 0) {
        return noPriceDelta;
      }

      const leftSpread = left.yesPrice !== null && left.noPrice !== null
        ? Math.abs(left.yesPrice - left.noPrice)
        : Infinity;
      const rightSpread = right.yesPrice !== null && right.noPrice !== null
        ? Math.abs(right.yesPrice - right.noPrice)
        : Infinity;

      if (leftSpread !== rightSpread) {
        return leftSpread - rightSpread;
      }

      return compareNullableNumberDesc(getDisplayVolume(left), getDisplayVolume(right));
    }

    if (sort === "liquidity") {
      return compareNullableNumberDesc(left.liquidity, right.liquidity);
    }

    if (sort === "volume") {
      return compareNullableNumberDesc(getDisplayVolume(left), getDisplayVolume(right));
    }

    return new Date(left.closeTime).getTime() - new Date(right.closeTime).getTime();
  });

  return sorted;
}

export function applyMarketQuery(markets: NormalizedMarket[], query: MarketQuery = {}) {
  const hasLiveFilter = query.onlyLive === true;
  const hasClosingWindow =
    query.maxHours !== null && query.maxHours !== undefined;
  const filtered = markets.filter((market) => {
    if (!matchesTimeWindow(market, query)) {
      return false;
    }

    if (!satisfiesYesPriceFloor(market, query.minYesPrice)) {
      return false;
    }

    if (!satisfiesNoPriceFloor(market, query.minNoPrice)) {
      return false;
    }

    if (query.platform && query.platform !== "all" && market.platform !== query.platform) {
      return false;
    }

    if (query.category && query.category !== "all") {
      if (!market.category || market.category.toLowerCase() !== query.category.toLowerCase()) {
        return false;
      }
    }

    if (query.minVolume !== null && query.minVolume !== undefined) {
      const volume = getDisplayVolume(market) ?? 0;

      if (volume < query.minVolume) {
        return false;
      }
    }

    if (query.tradeable !== null && query.tradeable !== undefined) {
      if (market.tradeable !== query.tradeable) {
        return false;
      }
    }

    if (hasLiveFilter || hasClosingWindow) {
      return true;
    }

    return new Date(market.closeTime).getTime() > Date.now();
  });

  const sort = query.sort ?? "urgency";

  if (query.onlyLive === true && sort === "soonest") {
    const now = Date.now();
    const sortedByLiveRecency = [...filtered].sort((left, right) => {
      const leftDelta = Math.abs(new Date(left.closeTime).getTime() - now);
      const rightDelta = Math.abs(new Date(right.closeTime).getTime() - now);
      return leftDelta - rightDelta;
    });

    return sortedByLiveRecency;
  }

  return sortMarkets(filtered, sort);
}
