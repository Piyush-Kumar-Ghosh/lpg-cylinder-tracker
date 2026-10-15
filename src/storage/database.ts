import Dexie, { type Table } from 'dexie';
import { CYLINDER_STATUSES, SPECIAL_USAGES, type AppSettings, type Cylinder, type NewCylinder } from '@/types';
import { isValidISODate } from '@/domain/dates';

export const DEFAULT_SETTINGS: AppSettings = {
  id: 1, householdName: '', householdMembers: null, city: '', currency: 'INR',
  deliveryBufferDays: 3, preferredCompany: 'Indane / Indian Oil', customCompanies: [],
  cylinderWeightKg: null, defaultSpecialUsage: 'normal', predictionMethod: 'median',
  primaryCylinderId: null,
  includeCurrentInAverages: false, bookingRemindersEnabled: true, bookingReminderLeadDays: 2,
  emptyRemindersEnabled: false, emptyReminderLeadDays: 3, missingInfoRemindersEnabled: true,
  systemNotificationsEnabled: false, demoMode: false, theme: 'system',
  defaultReportBasis: 'finish', schemaVersion: 1,
};

export function normalizeSettings(value: unknown): AppSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return DEFAULT_SETTINGS;
  const raw = value as Partial<AppSettings>;
  const bounded = (n: unknown, fallback: number, max: number) => typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(0, Math.round(n))) : fallback;
  return {
    ...DEFAULT_SETTINGS, ...raw, id: 1, schemaVersion: 1,
    householdName: typeof raw.householdName === 'string' ? raw.householdName.slice(0, 100) : '',
    householdMembers: typeof raw.householdMembers === 'number' && Number.isFinite(raw.householdMembers) ? Math.max(1, Math.round(raw.householdMembers)) : null,
    city: typeof raw.city === 'string' ? raw.city.slice(0, 100) : '',
    currency: typeof raw.currency === 'string' && /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : 'INR',
    customCompanies: Array.isArray(raw.customCompanies) ? raw.customCompanies.filter((x): x is string => typeof x === 'string').map(x => x.trim().slice(0, 80)).filter(Boolean).slice(0, 100) : [],
    preferredCompany: typeof raw.preferredCompany === 'string' ? raw.preferredCompany.slice(0, 80) : DEFAULT_SETTINGS.preferredCompany,
    cylinderWeightKg: typeof raw.cylinderWeightKg === 'number' && Number.isFinite(raw.cylinderWeightKg) && raw.cylinderWeightKg >= 0 ? raw.cylinderWeightKg : null,
    defaultSpecialUsage: SPECIAL_USAGES.includes(raw.defaultSpecialUsage as (typeof SPECIAL_USAGES)[number]) ? raw.defaultSpecialUsage! : 'normal',
    primaryCylinderId: typeof raw.primaryCylinderId === 'number' && Number.isInteger(raw.primaryCylinderId) && raw.primaryCylinderId > 0 ? raw.primaryCylinderId : null,
    predictionMethod: ['median','mean','weighted'].includes(raw.predictionMethod ?? '') ? raw.predictionMethod! : 'median',
    deliveryBufferDays: bounded(raw.deliveryBufferDays, 3, 90),
    bookingReminderLeadDays: bounded(raw.bookingReminderLeadDays, 2, 30),
    emptyReminderLeadDays: bounded(raw.emptyReminderLeadDays, 3, 30),
    defaultReportBasis: ['booking','delivery','start','finish'].includes(raw.defaultReportBasis ?? '') ? raw.defaultReportBasis! : 'finish',
    theme: ['system','light','dark'].includes(raw.theme ?? '') ? raw.theme! : 'system',
    bookingRemindersEnabled: typeof raw.bookingRemindersEnabled === 'boolean' ? raw.bookingRemindersEnabled : true,
    emptyRemindersEnabled: typeof raw.emptyRemindersEnabled === 'boolean' ? raw.emptyRemindersEnabled : false,
    missingInfoRemindersEnabled: typeof raw.missingInfoRemindersEnabled === 'boolean' ? raw.missingInfoRemindersEnabled : true,
    includeCurrentInAverages: typeof raw.includeCurrentInAverages === 'boolean' ? raw.includeCurrentInAverages : false,
  };
}

class LPGDatabase extends Dexie {
  cylinders!: Table<Cylinder, number, NewCylinder>;
  settings!: Table<AppSettings, number>;
  constructor() {
    super('household-lpg-tracker');
    this.version(1).stores({ cylinders: '++id, company, status, bookingDate, deliveryDate, startDate, finishDate, isDemo', settings: 'id' });
    this.on('populate', () => { void this.settings.put(DEFAULT_SETTINGS); });
  }
}

export const db = new LPGDatabase();
export async function getSettings() { return normalizeSettings(await db.settings.get(1)); }
export async function saveSettings(settings: AppSettings) { await db.settings.put(normalizeSettings(settings)); }

export function makeCylinder(input: Partial<NewCylinder> & Pick<NewCylinder, 'company'>): NewCylinder {
  const now = new Date().toISOString();
  return {
    company: input.company, status: input.status ?? 'booked', bookingDate: input.bookingDate ?? null,
    deliveryDate: input.deliveryDate ?? null, startDate: input.startDate ?? null, finishDate: input.finishDate ?? null,
    estimatedCylinderCost: input.estimatedCylinderCost ?? null, estimatedDeliveryFee: input.estimatedDeliveryFee ?? null,
    actualCylinderCost: input.actualCylinderCost ?? null, actualDeliveryFee: input.actualDeliveryFee ?? null,
    subsidy: input.subsidy ?? 0, specialUsage: input.specialUsage ?? 'normal', notes: input.notes ?? '',
    serialNumber: input.serialNumber ?? '', isDemo: input.isDemo ?? false, createdAt: now,
    updatedAt: now, schemaVersion: 1,
  };
}

export function validateCylinder(c: Partial<Cylinder>, allowEarlyStart = false): string[] {
  const errors: string[] = [];
  const date = (v: unknown) => isValidISODate(v);
  if (!c.company?.trim()) errors.push('Choose a company.');
  if (!c.bookingDate) errors.push('Enter a booking date.');
  if (c.status && !CYLINDER_STATUSES.includes(c.status)) errors.push('Choose a valid cylinder status.');
  if (c.specialUsage && !SPECIAL_USAGES.includes(c.specialUsage)) errors.push('Choose a valid special usage.');
  for (const [label, value] of [['Booking date', c.bookingDate], ['Delivery date', c.deliveryDate], ['Start date', c.startDate], ['Empty date', c.finishDate]] as const) {
    if (value && !date(value)) errors.push(`${label} is not a valid date.`);
  }
  if (c.deliveryDate && c.bookingDate && c.deliveryDate < c.bookingDate) errors.push('Delivery date cannot be before booking date.');
  if (!allowEarlyStart && c.startDate && c.deliveryDate && c.startDate < c.deliveryDate) errors.push('Start date cannot be before delivery date.');
  if (c.finishDate && c.startDate && c.finishDate < c.startDate) errors.push('Empty date cannot be before start date.');
  for (const n of [c.estimatedCylinderCost, c.estimatedDeliveryFee, c.actualCylinderCost, c.actualDeliveryFee, c.subsidy]) if (n != null && (!Number.isFinite(n) || n < 0)) errors.push('Costs and subsidy must be zero or more.');
  return [...new Set(errors)];
}
