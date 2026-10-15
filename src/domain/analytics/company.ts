/**
 * Per-company aggregation.
 *
 * Comparing suppliers is exactly where a small sample misleads, so every row
 * carries its own sample size and a `comparable` flag. The UI refuses to rank
 * companies — or to say one is cheaper — until each side has at least
 * {@link MIN_COMPARABLE_CYLINDERS} completed cylinders.
 */

import type { Cylinder } from '@/types';
import {
  EMPTY_FINANCIAL_TOTALS,
  isCostSettled,
  sumFinancials,
  type FinancialTotals,
} from '@/domain/calculations/financial';
import { calculateDaysUsed, calculateMeanDuration, calculateMedianDuration } from '@/domain/calculations/duration';

/** Below this many completed cylinders a company's averages are not comparable. */
export const MIN_COMPARABLE_CYLINDERS = 3;

export interface CompanyMetrics {
  company: string;
  cylinderCount: number;
  completedCount: number;
  averageDurationDays: number | null;
  medianDurationDays: number | null;
  financial: FinancialTotals;
  /** True when this company has enough completed cylinders to compare fairly. */
  comparable: boolean;
  cylinderIds: number[];
}

export interface CompanyReport {
  companies: CompanyMetrics[];
  /** True only when at least two companies each clear the comparability bar. */
  comparisonSupported: boolean;
  totals: FinancialTotals;
}

export const EMPTY_COMPANY_REPORT: CompanyReport = {
  companies: [],
  comparisonSupported: false,
  totals: { ...EMPTY_FINANCIAL_TOTALS },
};

export function calculateCompanyMetrics(cylinders: readonly Cylinder[]): CompanyReport {
  if (cylinders.length === 0) return { ...EMPTY_COMPANY_REPORT };

  const buckets = new Map<string, Cylinder[]>();
  for (const cylinder of cylinders) {
    const key = cylinder.company?.trim() || 'Unspecified';
    const bucket = buckets.get(key);
    if (bucket) bucket.push(cylinder);
    else buckets.set(key, [cylinder]);
  }

  const companies: CompanyMetrics[] = [...buckets.entries()]
    .map(([company, group]) => {
      const durations = group
        .map((c) => calculateDaysUsed(c))
        .filter((d): d is number => d != null);
      return {
        company,
        cylinderCount: group.length,
        completedCount: durations.length,
        averageDurationDays: calculateMeanDuration(durations),
        medianDurationDays: calculateMedianDuration(durations),
        financial: sumFinancials(group.filter(isCostSettled)),
        comparable: durations.length >= MIN_COMPARABLE_CYLINDERS,
        cylinderIds: group.map((c) => c.id).sort((a, b) => a - b),
      };
    })
    // Most-used company first; alphabetical tie-break keeps the order stable.
    .sort((a, b) => b.cylinderCount - a.cylinderCount || a.company.localeCompare(b.company));

  return {
    companies,
    comparisonSupported: companies.filter((c) => c.comparable).length >= 2,
    totals: sumFinancials(cylinders.filter(isCostSettled)),
  };
}

/** Distinct company names present in the data, alphabetically. */
export function companiesInUse(cylinders: readonly Cylinder[]): string[] {
  return [...new Set(cylinders.map((c) => c.company?.trim()).filter(Boolean) as string[])].sort(
    (a, b) => a.localeCompare(b),
  );
}
