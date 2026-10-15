/**
 * Currency and number formatting.
 *
 * Amounts are plain numbers of rupees (or whatever currency the household
 * picked). Formatting uses the Indian digit grouping convention — ₹1,24,500 —
 * when the currency is INR, and falls back to the browser default otherwise.
 */

const CURRENCY_LOCALES: Record<string, string> = {
  INR: 'en-IN',
  USD: 'en-US',
  EUR: 'de-DE',
  GBP: 'en-GB',
  AED: 'en-AE',
  AUD: 'en-AU',
  CAD: 'en-CA',
  SGD: 'en-SG',
};

export const SUPPORTED_CURRENCIES = Object.keys(CURRENCY_LOCALES);

function localeFor(currency: string): string {
  return CURRENCY_LOCALES[currency] ?? 'en-IN';
}

/** `1234.5` → `"₹1,234.50"`. Fractions are dropped when every value is whole. */
export function formatCurrency(
  amount: number | null | undefined,
  currency = 'INR',
  options: { compact?: boolean; alwaysDecimals?: boolean } = {},
): string {
  if (amount == null || !Number.isFinite(amount)) return '—';
  const hasFraction = Math.abs(amount % 1) > 0.004;
  try {
    return new Intl.NumberFormat(localeFor(currency), {
      style: 'currency',
      currency,
      notation: options.compact && Math.abs(amount) >= 100_000 ? 'compact' : 'standard',
      minimumFractionDigits: options.alwaysDecimals || hasFraction ? 2 : 0,
      maximumFractionDigits: options.alwaysDecimals || hasFraction ? 2 : 0,
    }).format(amount);
  } catch {
    // An unknown ISO currency code must not crash a dashboard.
    return `${currency} ${amount.toFixed(hasFraction ? 2 : 0)}`;
  }
}

/** Currency with no symbol — for axis ticks where the symbol repeats needlessly. */
export function formatAmountPlain(amount: number | null | undefined, currency = 'INR'): string {
  if (amount == null || !Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat(localeFor(currency), {
    maximumFractionDigits: 0,
  }).format(amount);
}

/** The bare symbol, e.g. `"₹"`. Used for input-field prefixes. */
export function currencySymbol(currency = 'INR'): string {
  try {
    const parts = new Intl.NumberFormat(localeFor(currency), {
      style: 'currency',
      currency,
    }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

/** `1234.567` → `"1,234.6"` with the requested precision. */
export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** Round to a fixed number of decimals without floating-point dust. */
export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** A signed percentage change, or `null` when the base is zero/unknown. */
export function percentChange(from: number, to: number): number | null {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

/** `12.4` → `"+12.4%"`, `-3` → `"−3.0%"`. */
export function formatPercentChange(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(1)}%`;
}
