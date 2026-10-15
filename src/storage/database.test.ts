import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

  it('normalizes malformed settings and rejects imported invalid dates and amounts', () => {
    expect(normalizeSettings({ deliveryBufferDays: -5, customCompanies: [' HP Gas ', 3] }).deliveryBufferDays).toBe(0);
    expect(normalizeSettings({ deliveryBufferDays: 4, customCompanies: [' HP Gas ', 3] }).customCompanies).toEqual(['HP Gas']);
    expect(validateCylinder({ company: 'Indane', bookingDate: '2026-02-31', status: 'booked', subsidy: -1 })).toEqual(expect.arrayContaining(['Booking date is not a valid date.', 'Costs and subsidy must be zero or more.']));
  });
});
