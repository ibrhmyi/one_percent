const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

export function formatDateTime(value: string | null) {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return dateTimeFormatter.format(date);
}

export function formatCompactCurrency(value: number | null) {
  if (value === null) {
    return "N/A";
  }

  return `$${compactFormatter.format(value)}`;
}

export function formatPrice(value: number | null) {
  if (value === null) {
    return "N/A";
  }

  const normalized = value > 1 ? value / 100 : value;
  const percent = normalized * 100;

  if (percent < 0.1) {
    return `${percent.toFixed(2)}%`;
  }

  if (percent < 1 || percent > 99) {
    return `${percent.toFixed(2)}%`;
  }

  return `${percent.toFixed(1)}%`;
}

export function formatPriceIndicator(value: number | null) {
  if (value === null) {
    return "N/A";
  }

  const normalized = value > 1 ? value / 100 : value;
  const cents = normalized * 100;
  return cents < 1 ? `${cents.toFixed(2)}¢` : `${cents.toFixed(1)}¢`;
}

export function formatSpread(value: number | null) {
  if (value === null) {
    return "N/A";
  }

  const normalized = value > 1 ? value / 100 : value;
  const cents = normalized * 100;
  return cents < 1 ? `${cents.toFixed(2)}¢` : `${cents.toFixed(1)}¢`;
}

export function formatCountdown(closeTime: string, now: number) {
  const closeAt = new Date(closeTime).getTime();

  if (Number.isNaN(closeAt)) {
    return "--:--:--";
  }

  const remainingMs = Math.max(0, closeAt - now);
  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}
