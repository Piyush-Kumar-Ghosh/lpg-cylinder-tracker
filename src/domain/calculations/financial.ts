/**
 * Canonical financial calculations.
 *
 * Every screen in the app reads money through these functions — there is no
 * second implementation anywhere. The rules, in order:
 *
 *   effective cylinder cost = actual  ?? estimated ?? 0
 *   effective delivery fee  = actual  ?? estimated ?? 0
 *   gross total             = effective cylinder cost + effective delivery fee
 *   net total               = gross total − subsidy
 *
 * Cylinder charge and delivery fee stay separate everywhere. Subsidy is a
 * straight deduction from gross — there is deliberately no subsidy ledger,
 * because an active subsidy is credited directly to the household's bank
 * account. **Cost per day is never calculated or displayed.**
 */

import type { Cylinder } from '@/types';
import { round } from '@/domain/money';

/** Clamp a possibly-missing money field to a non-negative number. */
function money(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value;
}

/**
 * The refill charge to use in calculations: what was really paid if known,
 * otherwise the estimate captured at booking.
 */
export function effectiveCylinderCost(cylinder: Pick<
  Cylinder,
  'actualCylinderCost' | 'estimatedCylinderCost'
>): number {
  return money(cylinder.actualCylinderCost ?? cylinder.estimatedCylinderCost);
}

/** The delivery charge to use in calculations. Same actual-over-estimate rule. */
export function effectiveDeliveryFee(cylinder: Pick<
  Cylinder,
  'actualDeliveryFee' | 'estimatedDeliveryFee'
>): number {
  return money(cylinder.actualDeliveryFee ?? cylinder.estimatedDeliveryFee);
}

/** True once at least one figure for this cylinder is a real paid amount. */
export function hasActualAmounts(
  cylinder: Pick<Cylinder, 'actualCylinderCost' | 'actualDeliveryFee'>,
): boolean {
  return cylinder.actualCylinderCost != null || cylinder.actualDeliveryFee != null;
}

/**
 * True when this cylinder's money has actually been spent, i.e. it has been
 * delivered. Expenditure reports count only settled cylinders so that a
 * speculative booking estimate never inflates a household's spending.
 */
export function isCostSettled(cylinder: Pick<Cylinder, 'deliveryDate'>): boolean {
  return cylinder.deliveryDate != null;
}

/** `cylinder cost + delivery fee`. Never user-editable. */
export function calculateGrossTotal(
  cylinder: Pick<
    Cylinder,
    'actualCylinderCost' | 'estimatedCylinderCost' | 'actualDeliveryFee' | 'estimatedDeliveryFee'
  >,
): number {
  return round(effectiveCylinderCost(cylinder) + effectiveDeliveryFee(cylinder), 2);
}

/** `gross total − subsidy`. Never user-editable. */
export function calculateNetTotal(
  cylinder: Pick<
    Cylinder,
    | 'actualCylinderCost'
    | 'estimatedCylinderCost'
    | 'actualDeliveryFee'
    | 'estimatedDeliveryFee'
    | 'subsidy'
  >,
): number {
  return round(calculateGrossTotal(cylinder) - money(cylinder.subsidy), 2);
}

/** Money fields rolled up over a set of cylinders. */
export interface FinancialTotals {
  /** How many cylinders contributed to these totals. */
  count: number;
  cylinderCharges: number;
  deliveryFees: number;
  gross: number;
  subsidy: number;
  net: number;
  /** Averages are `null` when `count` is 0 rather than a misleading 0. */
  averageCylinderCost: number | null;
  averageDeliveryFee: number | null;
  averageGross: number | null;
  averageNet: number | null;
}

export const EMPTY_FINANCIAL_TOTALS: FinancialTotals = {
  count: 0,
  cylinderCharges: 0,
  deliveryFees: 0,
  gross: 0,
  subsidy: 0,
  net: 0,
  averageCylinderCost: null,
  averageDeliveryFee: null,
  averageGross: null,
  averageNet: null,
};

/**
 * Roll up money across cylinders. Every component stays visible — charges,
 * fees, gross, subsidy and net are reported separately, never collapsed into a
 * single unexplained figure.
 */
export function sumFinancials(cylinders: readonly Cylinder[]): FinancialTotals {
  if (cylinders.length === 0) return { ...EMPTY_FINANCIAL_TOTALS };

  let cylinderCharges = 0;
  let deliveryFees = 0;
  let subsidy = 0;

  for (const cylinder of cylinders) {
    cylinderCharges += effectiveCylinderCost(cylinder);
    deliveryFees += effectiveDeliveryFee(cylinder);
    subsidy += money(cylinder.subsidy);
  }

  const gross = cylinderCharges + deliveryFees;
  const net = gross - subsidy;
  const count = cylinders.length;

  return {
    count,
    cylinderCharges: round(cylinderCharges, 2),
    deliveryFees: round(deliveryFees, 2),
    gross: round(gross, 2),
    subsidy: round(subsidy, 2),
    net: round(net, 2),
    averageCylinderCost: round(cylinderCharges / count, 2),
    averageDeliveryFee: round(deliveryFees / count, 2),
    averageGross: round(gross / count, 2),
    averageNet: round(net / count, 2),
  };
}

/** Cylinders whose money has been settled, i.e. the set expenditure reports use. */
export function settledCylinders(cylinders: readonly Cylinder[]): Cylinder[] {
  return cylinders.filter(isCostSettled);
}

/** True when the delivered amounts differ from what was expected at booking. */
export function estimateDiffersFromActual(cylinder: Cylinder): boolean {
  const estimate =
    money(cylinder.estimatedCylinderCost) + money(cylinder.estimatedDeliveryFee);
  if (!hasActualAmounts(cylinder)) return false;
  if (cylinder.estimatedCylinderCost == null && cylinder.estimatedDeliveryFee == null) {
    return false;
  }
  return Math.abs(estimate - calculateGrossTotal(cylinder)) > 0.004;
}
