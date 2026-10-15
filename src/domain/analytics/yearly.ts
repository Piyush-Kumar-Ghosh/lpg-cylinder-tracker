/**
 * Year-by-year aggregation and year-to-year comparison.
 *
 * Like the monthly report this takes an explicit reporting basis, so a figure
 * is never attributed to a year the household would not recognise.
 */

import type { Cylinder, ReportBasis } from '@/types';
import { yearOf } from '@/domain/dates';
import {
  EMPTY_FINANCIAL_TOTALS,
  isCostSettled,
  sumFinancials,
  type FinancialTotals,
} from '@/domain/calculations/financial';
import { calculateDaysUsed, calculateMeanDuration } from '@/domain/calculations/duration';
import { basisDate } from '@/domain/analytics/monthly';
import { percentChange, round } from '@/domain/money';

export interface YearlyMetrics {
  year: number;
  cylinderCount: number;
  completedCount: number;
  averageDurationDays: number | null;
  financial: FinancialTotals;
  cylinderIds: number[];
}

export interface YearlyReport {
  basis: ReportBasis;
  /** Ascending by year, gap-free across the observed range. */
  years: YearlyMetrics[];
  unassignedCount: number;
  totals: FinancialTotals;
}

export const EMPTY_YEARLY_REPORT: YearlyReport = {
  basis: 'finish',
  years: [],
  unassignedCount: 0,
  totals: { ...EMPTY_FINANCIAL_TOTALS },
};

export function calculateYearlyMetrics(
  cylinders: readonly Cylinder[],
  basis: ReportBasis,
): YearlyReport {
  const buckets = new Map<number, Cylinder[]>();
  let unassignedCount = 0;

  for (const cylinder of cylinders) {
    const date = basisDate(cylinder, basis);
    if (!date) {
      unassignedCount += 1;
      continue;
    }
    const year = yearOf(date);
    const bucket = buckets.get(year);
    if (bucket) bucket.push(cylinder);
    else buckets.set(year, [cylinder]);
  }

  if (buckets.size === 0) {
    return { ...EMPTY_YEARLY_REPORT, basis, unassignedCount };
  }

  const observed = [...buckets.keys()].sort((a, b) => a - b);
  const first = observed[0];
  const last = observed[observed.length - 1];

  const years: YearlyMetrics[] = [];
  for (let year = first; year <= last; year += 1) {
    const group = buckets.get(year) ?? [];
    const durations = group
      .map((c) => calculateDaysUsed(c))
      .filter((d): d is number => d != null);
    years.push({
      year,
      cylinderCount: group.length,
      completedCount: durations.length,
      averageDurationDays: calculateMeanDuration(durations),
      financial: sumFinancials(group.filter(isCostSettled)),
      cylinderIds: group.map((c) => c.id).sort((a, b) => a - b),
    });
  }

  return {
    basis,
    years,
    unassignedCount,
    totals: sumFinancials([...buckets.values()].flat().filter(isCostSettled)),
  };
}

export interface YearComparison {
  previous: YearlyMetrics;
  latest: YearlyMetrics;
  cylinderDelta: number;
  cylinderPercent: number | null;
  netDelta: number;
  netPercent: number | null;
  durationDelta: number | null;
}

/**
 * Compare the two most recent years that actually have cylinders.
 *
 * `null` when fewer than two such years exist — the app does not compare a year
 * against an empty one and call it a trend.
 */
export function compareLatestYears(report: YearlyReport): YearComparison | null {
  const active = report.years.filter((y) => y.cylinderCount > 0);
  if (active.length < 2) return null;

  const previous = active[active.length - 2];
  const latest = active[active.length - 1];

  const durationDelta =
    previous.averageDurationDays != null && latest.averageDurationDays != null
      ? round(latest.averageDurationDays - previous.averageDurationDays, 1)
      : null;

  return {
    previous,
    latest,
    cylinderDelta: latest.cylinderCount - previous.cylinderCount,
    cylinderPercent: percentChange(previous.cylinderCount, latest.cylinderCount),
    netDelta: round(latest.financial.net - previous.financial.net, 2),
    netPercent: percentChange(previous.financial.net, latest.financial.net),
    durationDelta,
  };
}

/** Cylinders actually used in a given calendar year, by the chosen basis. */
export function cylindersInYear(
  cylinders: readonly Cylinder[],
  year: number,
  basis: ReportBasis,
): Cylinder[] {
  return cylinders.filter((c) => {
    const date = basisDate(c, basis);
    return date != null && yearOf(date) === year;
  });
}
