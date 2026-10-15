/**
 * Lifecycle rules: which status a cylinder is in, which cylinder the household
 * is actually burning right now, and what the next sensible action is.
 *
 * The data model deliberately allows several simultaneously active cylinders —
 * households keep spares, take an early delivery, or run two connections. The
 * "current cylinder" is therefore *derived from the records*, never assumed to
 * be the newest row.
 */

import type { Cylinder, CylinderStatus } from '@/types';
import { compareDates } from '@/domain/dates';

/** The status implied purely by which dates are filled in. */
export function deriveStatusFromDates(
  cylinder: Pick<Cylinder, 'bookingDate' | 'deliveryDate' | 'startDate' | 'finishDate'>,
): CylinderStatus {
  if (cylinder.finishDate) return 'empty';
  if (cylinder.startDate) return 'in_use';
  if (cylinder.deliveryDate) return 'delivered';
  return 'booked';
}

/**
 * True when the stored status is compatible with the dates on the record.
 *
 * A household may legitimately mark a delivered cylinder as `stored` (a spare in
 * the corner) or a finished one as `returned`, so several statuses are valid for
 * the same set of dates.
 */
export function isStatusConsistent(cylinder: Cylinder): boolean {
  const { status, deliveryDate, startDate, finishDate } = cylinder;
  switch (status) {
    case 'booked':
      return !deliveryDate && !startDate && !finishDate;
    case 'delivered':
    case 'stored':
      return deliveryDate != null && !startDate && !finishDate;
    case 'in_use':
      return startDate != null && !finishDate;
    case 'empty':
    case 'returned':
      return finishDate != null;
    default:
      return false;
  }
}

/** A finished cylinder is one that has become empty (and possibly been returned). */
export function isFinished(cylinder: Pick<Cylinder, 'finishDate'>): boolean {
  return cylinder.finishDate != null;
}

/**
 * An *active* cylinder is one the household has started using and not yet
 * finished — the definition the spec gives for a current cylinder.
 */
export function isActive(cylinder: Pick<Cylinder, 'startDate' | 'finishDate'>): boolean {
  return cylinder.startDate != null && cylinder.finishDate == null;
}

/** On hand and ready to install: delivered or explicitly stored, not yet started. */
export function isSpare(cylinder: Cylinder): boolean {
  return (
    cylinder.finishDate == null &&
    cylinder.startDate == null &&
    cylinder.deliveryDate != null
  );
}

/** Booked with the dealer but not yet delivered. */
export function isAwaitingDelivery(cylinder: Cylinder): boolean {
  return cylinder.deliveryDate == null && cylinder.finishDate == null;
}

export interface LifecycleView {
  /** Every started-but-unfinished cylinder, newest start first. */
  active: Cylinder[];
  /**
   * The cylinder presented as "current" on the dashboard: the most recently
   * installed active cylinder, preferring one explicitly marked `in_use`.
   */
  current: Cylinder | null;
  /** Delivered or stored, awaiting installation. */
  spares: Cylinder[];
  /** Booked, awaiting delivery. */
  awaitingDelivery: Cylinder[];
  /** Completed cylinders, newest finish first. */
  finished: Cylinder[];
}

/**
 * Split a household's cylinders into the lifecycle buckets the UI needs.
 *
 * When more than one cylinder is active the app keeps them all and simply
 * highlights the most recently installed one, with a note that others are also
 * running. Nothing is hidden and no single-active constraint is imposed.
 */
export function buildLifecycleView(cylinders: readonly Cylinder[]): LifecycleView {
  const active: Cylinder[] = [];
  const spares: Cylinder[] = [];
  const awaitingDelivery: Cylinder[] = [];
  const finished: Cylinder[] = [];

  for (const cylinder of cylinders) {
    if (isFinished(cylinder)) finished.push(cylinder);
    else if (isActive(cylinder)) active.push(cylinder);
    else if (isSpare(cylinder)) spares.push(cylinder);
    else awaitingDelivery.push(cylinder);
  }

  // Newest start first; a later id breaks ties deterministically.
  active.sort(
    (a, b) => compareDates(b.startDate ?? '', a.startDate ?? '') || b.id - a.id,
  );
  spares.sort(
    (a, b) => compareDates(b.deliveryDate ?? '', a.deliveryDate ?? '') || b.id - a.id,
  );
  awaitingDelivery.sort(
    (a, b) => compareDates(b.bookingDate ?? '', a.bookingDate ?? '') || b.id - a.id,
  );
  finished.sort(
    (a, b) => compareDates(b.finishDate ?? '', a.finishDate ?? '') || b.id - a.id,
  );

  const explicitlyInUse = active.filter((c) => c.status === 'in_use');
  const current = explicitlyInUse[0] ?? active[0] ?? null;

  return { active, current, spares, awaitingDelivery, finished };
}

export type LifecycleAction = 'deliver' | 'start' | 'finish' | 'none';

/** The single next step for this cylinder, used to label its primary button. */
export function nextLifecycleAction(cylinder: Cylinder): LifecycleAction {
  if (cylinder.finishDate) return 'none';
  if (cylinder.startDate) return 'finish';
  if (cylinder.deliveryDate) return 'start';
  return 'deliver';
}

export const LIFECYCLE_ACTION_LABELS: Record<Exclude<LifecycleAction, 'none'>, string> = {
  deliver: 'Mark delivered',
  start: 'Start using',
  finish: 'Mark empty',
};

/** Records with a gap the household probably wants to fill in. */
export interface MissingInfoIssue {
  cylinderId: number;
  kind: 'missing_start' | 'missing_actual_cost' | 'stale_booking' | 'overdue_start';
  message: string;
}

/**
 * Gentle, factual nudges about incomplete records. These are *observations
 * about the user's own data*, not predictions, so they appear whenever they are
 * true rather than being gated on sample size.
 */
export function findMissingInformation(
  cylinders: readonly Cylinder[],
  today: string,
): MissingInfoIssue[] {
  const issues: MissingInfoIssue[] = [];

  for (const cylinder of cylinders) {
    if (cylinder.deliveryDate && !cylinder.startDate && !cylinder.finishDate) {
      issues.push({
        cylinderId: cylinder.id,
        kind: 'missing_start',
        message: `Cylinder #${cylinder.id} was delivered but has no start date yet.`,
      });
    }

    if (
      cylinder.deliveryDate &&
      cylinder.actualCylinderCost == null &&
      cylinder.actualDeliveryFee == null
    ) {
      issues.push({
        cylinderId: cylinder.id,
        kind: 'missing_actual_cost',
        message: `Cylinder #${cylinder.id} is delivered but still shows only estimated amounts.`,
      });
    }

    if (cylinder.bookingDate && !cylinder.deliveryDate && !cylinder.finishDate) {
      const ageDays = Math.max(
        0,
        Math.round(
          (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${cylinder.bookingDate}T00:00:00Z`)) /
            86_400_000,
        ),
      );
      if (ageDays > 14) {
        issues.push({
          cylinderId: cylinder.id,
          kind: 'stale_booking',
          message: `Cylinder #${cylinder.id} was booked ${ageDays} days ago and is still not marked delivered.`,
        });
      }
    }
  }

  return issues;
}
