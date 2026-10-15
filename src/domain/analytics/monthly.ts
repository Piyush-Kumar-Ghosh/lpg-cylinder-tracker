/**
 * Month-by-month aggregation.
 *
 * A cylinder spans weeks and usually two or three calendar months, so "which
 * month does it belong to?" has no single right answer. Rather than guess, the
 * report takes an explicit **basis** — booking, delivery, start or finish date —
 * and every figure on screen is labelled with the basis that produced it. A
 * cylinder with no date for the chosen basis is counted as *unassigned* instead
 * of being quietly dropped into the wrong month.
 */

import type { Cylinder, ReportBasis } from '@/types';
import type { MonthKey } from '@/domain/dates';
import {
  compareDates,
  formatMonthKey,
  monthKeyOf,
  monthKeyParts,
  monthKeyRange,
} from '@/domain/dates';
import {
  EMPTY_FINANCIAL_TOTALS,
  isCostSettled,
  sumFinancials,
  type FinancialTotals,
} from '@/domain/calculations/financial';
import { calculateDaysUsed, calculateMeanDuration } from '@/domain/calculations/duration';
import { round } from '@/domain/money';

/** The date a cylinder is filed under for a given reporting basis. */
export function basisDate(cylinder: Cylinder, basis: ReportBasis): string | null {
  switch (basis) {
    case 'booking':
      return cylinder.bookingDate;
    case 'delivery':
      return cylinder.deliveryDate;
    case 'start':
      return cylinder.startDate;
    case 'finish':
      return cylinder.finishDate;
    default:
      return null;
  }
}

export interface MonthlyMetrics {
  monthKey: MonthKey;
  label: string;
  year: number;
  /** 1-12 */
  month: number;
  /** Cylinders filed under this month by the chosen basis. */
  cylinderCount: number;
  /** How many of those are completed (so a duration exists). */
  completedCount: number;
  /** Mean duration of the completed cylinders in this month. `null` if none. */
  averageDurationDays: number | null;
  /** Money for the cylinders in this month whose cost is settled (delivered). */
  financial: FinancialTotals;
  cylinderIds: number[];
}

export interface MonthlyReport {
  basis: ReportBasis;
  /** Gap-free ascending months from the first to the last observed month. */
  months: MonthlyMetrics[];
  /** Cylinders with no date for this basis — reported, never misfiled. */
  unassignedCount: number;
  unassignedCylinderIds: number[];
  /** Totals across every assigned month. */
  totals: FinancialTotals;
  totalCylinders: number;
  totalCompleted: number;
}

export const EMPTY_MONTHLY_REPORT: MonthlyReport = {
  basis: 'finish',
  months: [],
  unassignedCount: 0,
  unassignedCylinderIds: [],
  totals: { ...EMPTY_FINANCIAL_TOTALS },
  totalCylinders: 0,
  totalCompleted: 0,
};

function emptyMonth(monthKey: MonthKey): MonthlyMetrics {
  const { year, month } = monthKeyParts(monthKey);
  return {
    monthKey,
    label: formatMonthKey(monthKey),
    year,
    month,
    cylinderCount: 0,
    completedCount: 0,
    averageDurationDays: null,
    financial: { ...EMPTY_FINANCIAL_TOTALS },
    cylinderIds: [],
  };
}

/**
 * Group cylinders into calendar months under the chosen basis.
 *
 * Months with no activity inside the observed range are included with zero
 * values so a trend line shows the gap honestly instead of compressing it.
 */
export function calculateMonthlyMetrics(
  cylinders: readonly Cylinder[],
  basis: ReportBasis,
): MonthlyReport {
  const buckets = new Map<MonthKey, Cylinder[]>();
  const unassigned: number[] = [];

  for (const cylinder of cylinders) {
    const date = basisDate(cylinder, basis);
    if (!date) {
      unassigned.push(cylinder.id);
      continue;
    }
    const key = monthKeyOf(date);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(cylinder);
    else buckets.set(key, [cylinder]);
  }

  if (buckets.size === 0) {
    return {
      ...EMPTY_MONTHLY_REPORT,
      basis,
      unassignedCount: unassigned.length,
      unassignedCylinderIds: unassigned,
    };
  }

  const observedKeys = [...buckets.keys()].sort(compareDates);
  const allKeys = monthKeyRange(observedKeys[0], observedKeys[observedKeys.length - 1]);

  const months: MonthlyMetrics[] = allKeys.map((key) => {
    const group = buckets.get(key);
    if (!group || group.length === 0) return emptyMonth(key);

    const durations = group
      .map((c) => calculateDaysUsed(c))
      .filter((d): d is number => d != null);

    const month = emptyMonth(key);
    month.cylinderCount = group.length;
    month.completedCount = durations.length;
    month.averageDurationDays = calculateMeanDuration(durations);
    month.financial = sumFinancials(group.filter(isCostSettled));
    month.cylinderIds = group.map((c) => c.id).sort((a, b) => a - b);
    return month;
  });

  const assigned = [...buckets.values()].flat();

  return {
    basis,
    months,
    unassignedCount: unassigned.length,
    unassignedCylinderIds: unassigned,
    totals: sumFinancials(assigned.filter(isCostSettled)),
    totalCylinders: assigned.length,
    totalCompleted: assigned.filter((c) => calculateDaysUsed(c) != null).length,
  };
}

/** Month-over-month change in net expenditure, for the trend caption. */
export function monthlyNetChange(report: MonthlyReport): number | null {
  const withSpend = report.months.filter((m) => m.financial.count > 0);
  if (withSpend.length < 2) return null;
  const previous = withSpend[withSpend.length - 2].financial.net;
  const latest = withSpend[withSpend.length - 1].financial.net;
  return round(latest - previous, 2);
}
