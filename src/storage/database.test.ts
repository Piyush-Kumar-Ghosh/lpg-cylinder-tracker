import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { db, getSettings, makeCylinder, normalizeSettings, saveSettings, validateCylinder } from '@/storage/database';

describe('local persistence', () => {
  beforeEach(async () => { await db.delete(); await db.open(); });
  afterEach(() => { db.close(); });

  it('keeps cylinders and settings after closing and reopening IndexedDB', async () => {
    const id = await db.cylinders.add(makeCylinder({ company: 'Indane / Indian Oil', bookingDate: '2026-10-01' }));
    await saveSettings({ ...(await getSettings()), householdName: 'Test home' });
    db.close(); await db.open();
    expect((await db.cylinders.get(id))?.bookingDate).toBe('2026-10-01');
    expect((await getSettings()).householdName).toBe('Test home');
  });

  it('migrates old expected/actual amounts without losing history', async () => {
    db.close(); await db.delete();
    const old = new Dexie('household-lpg-tracker');
    old.version(1).stores({ cylinders: '++id, company, status, bookingDate, deliveryDate, startDate, finishDate, isDemo', settings: 'id' });
    await old.open();
    await old.table('cylinders').add({ company: 'Indane / Indian Oil', status: 'empty', bookingDate: '2021-01-01', deliveryDate: '2021-01-02', startDate: '2021-01-02', finishDate: '2021-02-10', estimatedCylinderCost: 850, estimatedDeliveryFee: 20, actualCylinderCost: 875, actualDeliveryFee: 25, subsidy: 40, specialUsage: 'normal', notes: 'old record', serialNumber: '', isDemo: false, createdAt: '2021-01-01T00:00:00.000Z', updatedAt: '2021-02-10T00:00:00.000Z', schemaVersion: 1 });
    old.close();
    await db.open();
    const migrated = await db.cylinders.get(1);
    expect(migrated?.cylinderCost).toBe(875);
    expect(migrated?.deliveryFee).toBe(25);
    expect(migrated?.notes).toBe('old record');
    expect(migrated?.status).toBe('empty');
    expect(migrated).not.toHaveProperty('actualCylinderCost');
  });

  it('normalizes malformed settings and rejects imported invalid dates and amounts', () => {
    expect(normalizeSettings({ deliveryBufferDays: -5, customCompanies: [' HP Gas ', 3] }).deliveryBufferDays).toBe(0);
    expect(normalizeSettings({ deliveryBufferDays: 4, customCompanies: [' HP Gas ', 3] }).customCompanies).toEqual(['HP Gas']);
    expect(validateCylinder({ company: 'Indane', bookingDate: '2026-02-31', status: 'booked', subsidy: -1 })).toEqual(expect.arrayContaining(['Enter the start / installation date.', 'Booking date is not a valid date.', 'Cylinder charge and delivery fee are required and cannot be negative. Subsidy must be zero or more.']));
  });
});
