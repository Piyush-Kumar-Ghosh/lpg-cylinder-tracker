/**
 * Canonical duration calculations and the historical-sample statistics the
 * prediction engine is built on.
 *
 * Only *completed* cylinders (both a start date and a finish date) contribute
 * to historical averages. The cylinder currently in use is excluded by default
 * so a half-burned cylinder cannot drag the average down; a household can opt
 * in via Settings → Prediction.
 */

import type { Cylinder, ConfidenceLevel, ISODate, PredictionMethod } from '@/types';
import { compareDates, diffDays, isValidISODate, todayISO } from '@/domain/dates';
import { round } from '@/domain/money';

/** Days a completed cylinder lasted, or `null` while it is still in use. */
export function calculateDaysUsed(
  cylinder: Pick<Cylinder, 'startDate' | 'finishDate'>,
): number | null {
  const { startDate, finishDate } = cylinder;
  if (!startDate || !finishDate) return null;
  if (!isValidISODate(startDate) || !isValidISODate(finishDate)) return null;
  const days = diffDays(startDate, finishDate);
  return days < 0 ? null : days;
}

/** Days the in-use cylinder has been running so far. */
export function calculateCurrentAgeDays(
  cylinder: Pick<Cylinder, 'startDate' | 'finishDate'>,
  today: ISODate = todayISO(),
): number | null {
  if (!cylinder.startDate || cylinder.finishDate) return null;
  if (!isValidISODate(cylinder.startDate)) return null;
  const days = diffDays(cylinder.startDate, today);
  return days < 0 ? 0 : days;
}

/** True when a cylinder has a usable start→finish span. */
export function isCompleted(cylinder: Pick<Cylinder, 'startDate' | 'finishDate'>): boolean {
  return calculateDaysUsed(cylinder) != null;
}

export interface DurationSample {
  cylinderId: number;
  days: number;
  /** The finish date, used to order the sample chronologically. */
  finishDate: ISODate;
  company: string;
  specialUsage: Cylinder['specialUsage'];
}

/**
 * Completed-cylinder durations, oldest finish first.
 *
 * The chronological order matters: {@link calculateWeightedDuration} gives
 * later entries more weight.
 */
export function completedDurationSamples(cylinders: readonly Cylinder[]): DurationSample[] {
  const samples: DurationSample[] = [];
  for (const cylinder of cylinders) {
    const days = calculateDaysUsed(cylinder);
    if (days == null || !cylinder.finishDate) continue;
    samples.push({
      cylinderId: cylinder.id,
      days,
      finishDate: cylinder.finishDate,
      company: cylinder.company,
      specialUsage: cylinder.specialUsage,
    });
  }
  return samples.sort((a, b) => compareDates(a.finishDate, b.finishDate));
}

/** Just the day counts, oldest first. */
export function completedDurations(cylinders: readonly Cylinder[]): number[] {
  return completedDurationSamples(cylinders).map((s) => s.days);
}

/* --------------------------------------------------------------- averages -- */

/** Plain arithmetic mean. `null` for an empty sample. */
export function calculateMeanDuration(durations: readonly number[]): number | null {
  if (durations.length === 0) return null;
  const total = durations.reduce((sum, d) => sum + d, 0);
  return round(total / durations.length, 2);
}

/**
 * Median — the default, because one freak cylinder (a month-long holiday, a
 * festival fortnight) cannot drag it around the way it drags a mean.
 */
export function calculateMedianDuration(durations: readonly number[]): number | null {
  if (durations.length === 0) return null;
  const sorted = [...durations].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return round(value, 2);
}

/**
 * Linearly weighted average over a chronologically ordered sample: the oldest
 * cylinder carries weight 1, the newest weight `n`. Recent household habits
 * therefore count for more without discarding history.
 *
 * `durations` MUST be ordered oldest-first (as {@link completedDurations} returns).
 */
export function calculateWeightedDuration(durations: readonly number[]): number | null {
  if (durations.length === 0) return null;
  let weightedSum = 0;
  let weightTotal = 0;
  durations.forEach((days, index) => {
    const weight = index + 1;
    weightedSum += days * weight;
    weightTotal += weight;
  });
  return round(weightedSum / weightTotal, 2);
}

/** Dispatch to the household's chosen method. */
export function estimateDuration(
  durations: readonly number[],
  method: PredictionMethod,
): number | null {
  switch (method) {
    case 'mean':
      return calculateMeanDuration(durations);
    case 'weighted':
      return calculateWeightedDuration(durations);
    case 'median':
    default:
      return calculateMedianDuration(durations);
  }
}

/* ------------------------------------------------------------ dispersion -- */

/** Population standard deviation. `null` for fewer than two values. */
export function calculateStdDev(durations: readonly number[]): number | null {
  if (durations.length < 2) return null;
  const mean = durations.reduce((s, d) => s + d, 0) / durations.length;
  const variance =
    durations.reduce((s, d) => s + (d - mean) ** 2, 0) / durations.length;
  return round(Math.sqrt(variance), 2);
}

/** Spread relative to the mean. Drives the confidence downgrade rule. */
export function coefficientOfVariation(durations: readonly number[]): number | null {
  if (durations.length < 2) return null;
  const mean = durations.reduce((s, d) => s + d, 0) / durations.length;
  if (mean === 0) return null;
  const sd = calculateStdDev(durations);
  return sd == null ? null : round(sd / mean, 4);
}

/** Median absolute deviation — a robust spread measure used for outlier flags. */
export function medianAbsoluteDeviation(durations: readonly number[]): number | null {
  const median = calculateMedianDuration(durations);
  if (median == null || durations.length < 3) return null;
  const deviations = durations.map((d) => Math.abs(d - median));
  return calculateMedianDuration(deviations);
}

/**
 * Cylinder ids whose duration sits far from the household's median.
 *
 * Uses the robust modified z-score (threshold 3.5). These are *flagged for the
 * user to interpret*, never silently dropped from statistics — a short cylinder
 * usually has an explanation sitting in its Special Usage field.
 */
export function findDurationOutliers(samples: readonly DurationSample[]): number[] {
  if (samples.length < 4) return [];
  const durations = samples.map((s) => s.days);
  const median = calculateMedianDuration(durations);
  const mad = medianAbsoluteDeviation(durations);
  if (median == null || mad == null || mad === 0) return [];
  return samples
    .filter((s) => Math.abs((0.6745 * (s.days - median)) / mad) > 3.5)
    .map((s) => s.cylinderId);
}

/* ------------------------------------------------------------ confidence -- */

/**
 * How much to trust an estimate built from `durations`.
 *
 * The rule is fixed and documented rather than a manufactured score:
 *
 *   0 completed cylinders            → `none`  ("Not enough historical data yet")
 *   1-2                              → `low`
 *   3-5                              → `medium`
 *   6+                               → `high`, downgraded to `medium` when the
 *                                      sample is very scattered (coefficient of
 *                                      variation above 0.35)
 */
export function calculateConfidence(durations: readonly number[]): ConfidenceLevel {
  const n = durations.length;
  if (n === 0) return 'none';
  if (n < 3) return 'low';
  if (n < 6) return 'medium';
  const cv = coefficientOfVariation(durations);
  if (cv != null && cv > 0.35) return 'medium';
  return 'high';
}

export interface DurationStats {
  sampleSize: number;
  durations: number[];
  mean: number | null;
  median: number | null;
  weighted: number | null;
  shortest: DurationSample | null;
  longest: DurationSample | null;
  stdDev: number | null;
  coefficientOfVariation: number | null;
  confidence: ConfidenceLevel;
  outlierCylinderIds: number[];
}

export const EMPTY_DURATION_STATS: DurationStats = {
  sampleSize: 0,
  durations: [],
  mean: null,
  median: null,
  weighted: null,
  shortest: null,
  longest: null,
  stdDev: null,
  coefficientOfVariation: null,
  confidence: 'none',
  outlierCylinderIds: [],
};

/** Everything the UI needs to describe a household's completed-cylinder history. */
export function calculateDurationStats(cylinders: readonly Cylinder[]): DurationStats {
  const samples = completedDurationSamples(cylinders);
  if (samples.length === 0) return { ...EMPTY_DURATION_STATS };

  const durations = samples.map((s) => s.days);
  let shortest = samples[0];
  let longest = samples[0];
  for (const sample of samples) {
    if (sample.days < shortest.days) shortest = sample;
    if (sample.days > longest.days) longest = sample;
  }

  return {
    sampleSize: samples.length,
    durations,
    mean: calculateMeanDuration(durations),
    median: calculateMedianDuration(durations),
    weighted: calculateWeightedDuration(durations),
    shortest,
    longest,
    stdDev: calculateStdDev(durations),
    coefficientOfVariation: coefficientOfVariation(durations),
    confidence: calculateConfidence(durations),
    outlierCylinderIds: findDurationOutliers(samples),
  };
}

/**
 * Estimated cylinders per year, derived from real historical duration.
 *
 * Returns `null` below three completed cylinders: an "annual estimate" built
 * from one or two cylinders is noise, and the app would rather say nothing.
 */
export function calculateEstimatedCylindersPerYear(
  estimatedDurationDays: number | null,
  sampleSize: number,
): number | null {
  if (estimatedDurationDays == null || estimatedDurationDays <= 0) return null;
  if (sampleSize < 3) return null;
  return round(365.25 / estimatedDurationDays, 1);
}
