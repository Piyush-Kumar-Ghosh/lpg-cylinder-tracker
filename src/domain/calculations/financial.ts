import type { Cylinder } from '@/types';
import { round } from '@/domain/money';

const money = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
export const effectiveCylinderCost = (c: Pick<Cylinder, 'cylinderCost'>) => money(c.cylinderCost);
export const effectiveDeliveryFee = (c: Pick<Cylinder, 'deliveryFee'>) => money(c.deliveryFee);
export const hasActualAmounts = (_c: Pick<Cylinder, 'cylinderCost' | 'deliveryFee'>) => true;
export const isCostSettled = (c: Pick<Cylinder, 'startDate'>) => c.startDate != null;
export function calculateGrossTotal(c: Pick<Cylinder, 'cylinderCost' | 'deliveryFee'>) { return round(effectiveCylinderCost(c) + effectiveDeliveryFee(c), 2); }
export function calculateNetTotal(c: Pick<Cylinder, 'cylinderCost' | 'deliveryFee' | 'subsidy'>) { return round(calculateGrossTotal(c) - money(c.subsidy), 2); }
export interface FinancialTotals { count:number; cylinderCharges:number; deliveryFees:number; gross:number; subsidy:number; net:number; averageCylinderCost:number|null; averageDeliveryFee:number|null; averageGross:number|null; averageNet:number|null }
export const EMPTY_FINANCIAL_TOTALS: FinancialTotals = {count:0,cylinderCharges:0,deliveryFees:0,gross:0,subsidy:0,net:0,averageCylinderCost:null,averageDeliveryFee:null,averageGross:null,averageNet:null};
export function sumFinancials(cylinders: readonly Cylinder[]): FinancialTotals {
  const count=cylinders.length; if(!count) return {...EMPTY_FINANCIAL_TOTALS};
  const cylinderCharges=cylinders.reduce((s,c)=>s+effectiveCylinderCost(c),0), deliveryFees=cylinders.reduce((s,c)=>s+effectiveDeliveryFee(c),0), subsidy=cylinders.reduce((s,c)=>s+money(c.subsidy),0), gross=cylinderCharges+deliveryFees, net=gross-subsidy;
  return {count,cylinderCharges:round(cylinderCharges,2),deliveryFees:round(deliveryFees,2),gross:round(gross,2),subsidy:round(subsidy,2),net:round(net,2),averageCylinderCost:round(cylinderCharges/count,2),averageDeliveryFee:round(deliveryFees/count,2),averageGross:round(gross/count,2),averageNet:round(net/count,2)};
}
export const settledCylinders = (cylinders: readonly Cylinder[]) => cylinders.filter(isCostSettled);
export const estimateDiffersFromActual = (_cylinder: Cylinder) => false;
