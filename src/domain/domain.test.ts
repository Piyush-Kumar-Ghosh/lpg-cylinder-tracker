import { describe, expect, it } from 'vitest';
import type { Cylinder } from '@/types';
import { addDays, isValidISODate } from '@/domain/dates';
import { calculateGrossTotal, calculateNetTotal } from '@/domain/calculations/financial';
import { calculateDaysUsed, calculateMeanDuration, calculateMedianDuration, calculateWeightedDuration, calculateEstimatedCylindersPerYear } from '@/domain/calculations/duration';
import { buildPrediction } from '@/domain/calculations/prediction';
import { calculateMonthlyMetrics } from '@/domain/analytics/monthly';
import { calculateYearlyMetrics, compareLatestYears } from '@/domain/analytics/yearly';
import { calculateCompanyMetrics } from '@/domain/analytics/company';
import { parseCylindersCsv, serializeCylindersCsv } from '@/services/transfer';
import { validateCylinder } from '@/storage/database';

function cylinder(id: number, company: string, startDate: string, finishDate: string, patch: Partial<Cylinder> = {}): Cylinder {
  return { id, company, status: 'empty', bookingDate: startDate, deliveryDate: startDate, startDate, finishDate,
    cylinderCost: 900, deliveryFee: 25,
    subsidy: 50, specialUsage: 'normal', notes: '', serialNumber: '', isDemo: false,
    createdAt: startDate, updatedAt: finishDate, schemaVersion: 1, ...patch };
}

describe('cylinder calculations', () => {
  it('calculates gross and net totals separately', () => {
    const c = cylinder(1, 'Indane', '2026-01-01', '2026-02-10');
    expect(calculateGrossTotal(c)).toBe(925);
    expect(calculateNetTotal(c)).toBe(875);
  });
  it('calculates calendar days without timezone drift', () => {
    expect(calculateDaysUsed(cylinder(1, 'Indane', '2026-01-01', '2026-02-10'))).toBe(40);
    expect(isValidISODate('2026-02-30')).toBe(false);
  });
  it('calculates mean, median, and recency-weighted duration', () => {
    expect(calculateMeanDuration([40, 43, 41, 45, 42])).toBe(42.2);
    expect(calculateMedianDuration([40, 43, 41, 45, 42])).toBe(42);
    expect(calculateWeightedDuration([40, 43, 41, 45, 42])).toBeGreaterThan(42);
  });
  it('predicts empty and suggested booking dates from historical duration', () => {
    const current = cylinder(4, 'Indane', '2026-09-04', '2026-10-01', { status: 'in_use', finishDate: null });
    const result = buildPrediction({ cylinder: current, historyDurations: [40, 43, 41, 45, 42], method: 'median', deliveryBufferDays: 3, today: '2026-09-20' });
    expect(result.predictedEmptyDate).toBe('2026-10-16');
    expect(result.suggestedBookingDate).toBe('2026-10-13');
    expect(result.confidence).toBe('medium');
    expect(result.workings).toHaveLength(4);
  });
  it('labels short history as low confidence and does not predict without history', () => {
    const current = cylinder(4, 'Indane', '2026-09-04', '2026-10-01', { status: 'in_use', finishDate: null });
    const one = buildPrediction({ cylinder: current, historyDurations: [40], method: 'median', deliveryBufferDays: 3, today: '2026-09-20' });
    expect(one.confidence).toBe('low');
    expect(buildPrediction({ cylinder: current, historyDurations: [], method: 'median', deliveryBufferDays: 3, today: '2026-09-20' }).available).toBe(false);
    expect(calculateEstimatedCylindersPerYear(42, 2)).toBeNull();
  });
  it('aggregates monthly, yearly, and company reports without mixing date bases', () => {
    const records = [cylinder(1, 'Indane', '2025-11-01', '2025-12-11'), cylinder(2, 'HP Gas', '2025-12-15', '2026-01-25')];
    const byFinish = calculateMonthlyMetrics(records, 'finish');
    const byStart = calculateMonthlyMetrics(records, 'start');
    expect(byFinish.months.map(m => m.monthKey)).toEqual(['2025-12', '2026-01']);
    expect(byStart.months.map(m => m.monthKey)).toEqual(['2025-11', '2025-12']);
    expect(calculateYearlyMetrics(records, 'finish').years.map(y => y.year)).toEqual([2025, 2026]);
    const allCompanies = [...records, cylinder(3, 'Bharatgas', '2025-07-01', '2025-08-10'), cylinder(4, 'Local LPG', '2025-04-01', '2025-05-11')];
    expect(calculateCompanyMetrics(allCompanies).companies.map(c => c.company).sort()).toEqual(['Bharatgas', 'HP Gas', 'Indane', 'Local LPG']);
    expect(compareLatestYears(calculateYearlyMetrics(records, 'finish'))?.latest.year).toBe(2026);
  });
  it('keeps special-use cylinders in the household duration sample', () => {
    const records = [cylinder(1, 'Indane', '2026-01-01', '2026-02-10', { specialUsage: 'guests' })];
    expect(calculateDaysUsed(records[0])).toBe(40);
    expect(addDays('2026-09-04', 42)).toBe('2026-10-16');
  });
  it('round-trips CSV fields containing commas and quotes', () => {
    const original = cylinder(8, 'Custom LPG', '2026-01-01', '2026-02-10', { notes: 'Guests, then "festival" cooking' });
    const [returned] = parseCylindersCsv(serializeCylindersCsv([original]));
    expect(returned.company).toBe(original.company);
    expect(returned.notes).toBe(original.notes);
    expect(Number(returned.cylinderCost)).toBe(original.cylinderCost);
    expect(returned.finishDate).toBe(original.finishDate);
  });
  it('rejects negative charges, subsidy, and invalid lifecycle dates', () => {
    const base = cylinder(1, 'Indane', '2026-01-01', '2026-02-10');
    expect(validateCylinder({ ...base, cylinderCost: -1 })).toContain('Cylinder charge and delivery fee are required and cannot be negative. Subsidy must be zero or more.');
    expect(validateCylinder({ ...base, subsidy: -1 })).toContain('Cylinder charge and delivery fee are required and cannot be negative. Subsidy must be zero or more.');
    expect(validateCylinder({ ...base, finishDate: '2025-12-31' })).toContain('Empty date cannot be before start date.');
  });
});
