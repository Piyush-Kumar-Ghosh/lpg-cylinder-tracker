/**
 * The prediction engine.
 *
 * Everything here is arithmetic on the household's own completed cylinders —
 * there is no model, no remote call and nothing invented. When the data cannot
 * support an estimate the functions return `null` and the UI says so plainly.
 *
 *   estimated duration    = median | mean | weighted average of completed durations
 *   predicted empty date  = start date + estimated duration
 *   suggested booking date = predicted empty date − delivery buffer
 */

import type {
  ConfidenceLevel,
  Cylinder,
  ISODate,
  PredictionMethod,
} from '@/types';
import { addDays, diffDays, isValidISODate, todayISO } from '@/domain/dates';
import {
  calculateConfidence,
  calculateCurrentAgeDays,
  estimateDuration,
} from '@/domain/calculations/duration';

/** `start + round(duration)`. `null` when either input is unusable. */
export function calculatePredictedEmptyDate(
  startDate: ISODate | null,
  estimatedDurationDays: number | null,
): ISODate | null {
  if (!startDate || !isValidISODate(startDate)) return null;
  if (estimatedDurationDays == null || !Number.isFinite(estimatedDurationDays)) return null;
  if (estimatedDurationDays <= 0) return null;
  return addDays(startDate, Math.round(estimatedDurationDays));
}

/** `predicted empty date − delivery buffer`. */
export function calculateSuggestedBookingDate(
  predictedEmptyDate: ISODate | null,
  deliveryBufferDays: number,
): ISODate | null {
  if (!predictedEmptyDate || !isValidISODate(predictedEmptyDate)) return null;
  const buffer = Number.isFinite(deliveryBufferDays) ? Math.max(0, Math.round(deliveryBufferDays)) : 0;
  return addDays(predictedEmptyDate, -buffer);
}

export interface PredictionInput {
  /** The cylinder to predict for — normally the dashboard's current cylinder. */
  cylinder: Cylinder | null;
  /** Completed-cylinder durations, oldest first. */
  historyDurations: readonly number[];
  method: PredictionMethod;
  deliveryBufferDays: number;
  today?: ISODate;
  /** When true, the current cylinder's elapsed days join the sample. */
  includeCurrentInAverages?: boolean;
}

export interface Prediction {
  /** False when there is no current cylinder or no usable history. */
  available: boolean;
  method: PredictionMethod;
  /** How many completed cylinders fed the estimate. */
  sampleSize: number;
  confidence: ConfidenceLevel;
  estimatedDurationDays: number | null;
  startDate: ISODate | null;
  currentAgeDays: number | null;
  predictedEmptyDate: ISODate | null;
  /** Negative once the cylinder has outlived its estimate. */
  estimatedDaysRemaining: number | null;
  suggestedBookingDate: ISODate | null;
  deliveryBufferDays: number;
  /** True when today is past the predicted empty date. */
  isOverdue: boolean;
  /** Human-readable reason an estimate is unavailable, if it is. */
  unavailableReason: string | null;
  /** Step-by-step working, shown in the UI so the estimate is never a magic number. */
  workings: string[];
}

export const UNAVAILABLE_PREDICTION: Prediction = {
  available: false,
  method: 'median',
  sampleSize: 0,
  confidence: 'none',
  estimatedDurationDays: null,
  startDate: null,
  currentAgeDays: null,
  predictedEmptyDate: null,
  estimatedDaysRemaining: null,
  suggestedBookingDate: null,
  deliveryBufferDays: 3,
  isOverdue: false,
  unavailableReason: 'No cylinder is currently in use.',
  workings: [],
};

const METHOD_WORDS: Record<PredictionMethod, string> = {
  median: 'Median',
  mean: 'Mean',
  weighted: 'Weighted average',
};

/**
 * Build the full, self-explaining prediction for one cylinder.
 *
 * `available` is false — with a reason the UI can show verbatim — whenever the
 * household has no cylinder in use or no completed cylinder to learn from.
 */
export function buildPrediction(input: PredictionInput): Prediction {
  const {
    cylinder,
    historyDurations,
    method,
    deliveryBufferDays,
    today = todayISO(),
    includeCurrentInAverages = false,
  } = input;

  const buffer = Number.isFinite(deliveryBufferDays)
    ? Math.max(0, Math.round(deliveryBufferDays))
    : 3;

  if (!cylinder || !cylinder.startDate || cylinder.finishDate) {
    return { ...UNAVAILABLE_PREDICTION, method, deliveryBufferDays: buffer };
  }

  const currentAgeDays = calculateCurrentAgeDays(cylinder, today);

  const sample = [...historyDurations];
  if (includeCurrentInAverages && currentAgeDays != null && currentAgeDays > 0) {
    sample.push(currentAgeDays);
  }

  const confidence = calculateConfidence(sample);

  if (sample.length === 0) {
    return {
      available: false,
      method,
      sampleSize: 0,
      confidence: 'none',
      estimatedDurationDays: null,
      startDate: cylinder.startDate,
      currentAgeDays,
      predictedEmptyDate: null,
      estimatedDaysRemaining: null,
      suggestedBookingDate: null,
      deliveryBufferDays: buffer,
      isOverdue: false,
      unavailableReason:
        'Not enough historical data yet — finish at least one cylinder to get an estimate.',
      workings: [],
    };
  }

  const estimatedDurationDays = estimateDuration(sample, method);
  const predictedEmptyDate = calculatePredictedEmptyDate(
    cylinder.startDate,
    estimatedDurationDays,
  );
  const suggestedBookingDate = calculateSuggestedBookingDate(predictedEmptyDate, buffer);
  const estimatedDaysRemaining =
    predictedEmptyDate != null ? diffDays(today, predictedEmptyDate) : null;

  const sortedPreview = [...sample].sort((a, b) => a - b);
  const preview =
    sortedPreview.length > 8
      ? `${sortedPreview.slice(0, 4).join(', ')} … ${sortedPreview.slice(-3).join(', ')}`
      : sortedPreview.join(', ');

  const workings = [
    `${sample.length} completed cylinder${sample.length === 1 ? '' : 's'} lasted: ${preview} days`,
    `${METHOD_WORDS[method]} of that history: ${estimatedDurationDays} days`,
    `Started ${cylinder.startDate} + ${
      estimatedDurationDays == null ? '—' : Math.round(estimatedDurationDays)
    } days → estimated empty ${predictedEmptyDate ?? '—'}`,
    `Estimated empty − ${buffer} day delivery buffer → suggested booking ${
      suggestedBookingDate ?? '—'
    }`,
  ];

  return {
    available: predictedEmptyDate != null,
    method,
    sampleSize: sample.length,
    confidence,
    estimatedDurationDays,
    startDate: cylinder.startDate,
    currentAgeDays,
    predictedEmptyDate,
    estimatedDaysRemaining,
    suggestedBookingDate,
    deliveryBufferDays: buffer,
    isOverdue: estimatedDaysRemaining != null && estimatedDaysRemaining < 0,
    unavailableReason: predictedEmptyDate == null ? 'Could not derive an estimate.' : null,
    workings,
  };
}

/**
 * Whether a booking reminder is actually due.
 *
 * It becomes due `leadDays` before the suggested booking date and never earlier
 * — a reminder shown weeks ahead of time is just noise.
 */
export function isBookingReminderDue(
  suggestedBookingDate: ISODate | null,
  leadDays: number,
  today: ISODate = todayISO(),
): boolean {
  if (!suggestedBookingDate || !isValidISODate(suggestedBookingDate)) return false;
  const lead = Number.isFinite(leadDays) ? Math.max(0, Math.round(leadDays)) : 0;
  return diffDays(today, suggestedBookingDate) <= lead;
}

/** Whether a predicted-empty reminder is due, using its own lead time. */
export function isEmptyReminderDue(
  predictedEmptyDate: ISODate | null,
  leadDays: number,
  today: ISODate = todayISO(),
): boolean {
  if (!predictedEmptyDate || !isValidISODate(predictedEmptyDate)) return false;
  const lead = Number.isFinite(leadDays) ? Math.max(0, Math.round(leadDays)) : 0;
  return diffDays(today, predictedEmptyDate) <= lead;
}
