import { describe, expect, it } from 'vitest';
import { extractReceiptFields } from '@/services/receipt';

describe('receipt field suggestions', () => {
  it('recognizes common LPG providers, dated receipts, charges, and subsidy', () => {
    const fields = extractReceiptFields(`Indane Indian Oil\nBooking Date: 12/03/2021\nCylinder refill Rs 850.00\nDelivery charge Rs 25\nSubsidy Rs 40`);
    expect(fields.company).toBe('Indane / Indian Oil');
    expect(fields.bookingDate).toBe('2021-03-12');
    expect(fields.cylinderCost).toBe(850);
    expect(fields.deliveryFee).toBe(25);
    expect(fields.subsidy).toBe(40);
  });

  it('does not invent values when receipt text has no recognizable labels', () => {
    expect(extractReceiptFields('Thank you for your purchase')).toEqual({});
  });
});
