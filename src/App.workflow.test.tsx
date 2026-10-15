import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '@/App';
import { addDays, formatLongDate, todayISO } from '@/domain/dates';
import { db, getSettings, makeCylinder } from '@/storage/database';

describe('household cylinder workflow', () => {
  beforeEach(async () => { await db.delete(); await db.open(); });
  afterEach(() => { cleanup(); db.close(); });

  it('books, delivers, starts, finishes, and reflects actual charges and duration', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Book your first cylinder' }));
    const booking = screen.getByRole('dialog');
    await user.clear(within(booking).getByLabelText('Booking date'));
    await user.type(within(booking).getByLabelText('Booking date'), addDays(todayISO(), -80));
    await user.type(within(booking).getByLabelText('Expected cylinder charge'), '900');
    await user.type(within(booking).getByLabelText('Expected delivery fee'), '30');
    await user.clear(within(booking).getByLabelText('Subsidy'));
    await user.type(within(booking).getByLabelText('Subsidy'), '50');
    await user.click(within(booking).getByRole('button', { name: 'Save booking' }));

    await user.click(await screen.findByRole('button', { name: 'Mark delivered · #1' }));
    const delivery = screen.getByRole('dialog');
    await user.clear(within(delivery).getByLabelText('Delivery date'));
    await user.type(within(delivery).getByLabelText('Delivery date'), addDays(todayISO(), -79));
    await user.clear(within(delivery).getByLabelText('Actual cylinder charge'));
    await user.type(within(delivery).getByLabelText('Actual cylinder charge'), '885');
    await user.clear(within(delivery).getByLabelText('Actual delivery fee'));
    await user.type(within(delivery).getByLabelText('Actual delivery fee'), '25');
    await user.click(within(delivery).getByRole('button', { name: 'Confirm delivery' }));

    await user.click(await screen.findByRole('button', { name: 'Start using · #1' }));
    const installation = screen.getByRole('dialog');
    await user.clear(within(installation).getByLabelText('Start / installation date'));
    await user.type(within(installation).getByLabelText('Start / installation date'), addDays(todayISO(), -78));
    await user.click(within(installation).getByRole('button', { name: 'Confirm start date' }));

    await user.click(await screen.findByRole('button', { name: 'Mark empty · #1' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm empty date' }));
    expect(await screen.findByText('78 days')).toBeInTheDocument();
    expect(screen.getByText('₹910')).toBeInTheDocument();
    expect(screen.getAllByText('₹860')).toHaveLength(2);
    expect((await db.cylinders.get(1))?.status).toBe('empty');
  });

  it('uses completed history for a current-cylinder estimate and updates dependents after edit/delete', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Book your first cylinder' }));
    const booking = screen.getByRole('dialog');
    await user.clear(within(booking).getByLabelText('Booking date'));
    await user.type(within(booking).getByLabelText('Booking date'), addDays(todayISO(), -80));
    await user.click(within(booking).getByRole('button', { name: 'Save booking' }));
    await user.click(await screen.findByRole('button', { name: 'Mark delivered · #1' }));
    const delivery = screen.getByRole('dialog');
    await user.clear(within(delivery).getByLabelText('Delivery date'));
    await user.type(within(delivery).getByLabelText('Delivery date'), addDays(todayISO(), -79));
    await user.click(within(delivery).getByRole('button', { name: 'Confirm delivery' }));
    await user.click(await screen.findByRole('button', { name: 'Start using · #1' }));
    const installation = screen.getByRole('dialog');
    await user.clear(within(installation).getByLabelText('Start / installation date'));
    await user.type(within(installation).getByLabelText('Start / installation date'), addDays(todayISO(), -78));
    await user.click(within(installation).getByRole('button', { name: 'Confirm start date' }));
    await user.click(await screen.findByRole('button', { name: 'Mark empty · #1' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm empty date' }));

    await user.click(screen.getAllByRole('button', { name: '＋ Book cylinder' })[0]);
    const nextBooking = screen.getByRole('dialog');
    await user.selectOptions(within(nextBooking).getByLabelText('Company'), 'HP Gas / Hindustan Petroleum');
    await user.clear(within(nextBooking).getByLabelText('Booking date'));
    await user.type(within(nextBooking).getByLabelText('Booking date'), addDays(todayISO(), -7));
    await user.click(within(nextBooking).getByRole('button', { name: 'Save booking' }));
    await user.click(await screen.findByRole('button', { name: 'Mark delivered · #2' }));
    const nextDelivery = screen.getByRole('dialog');
    await user.clear(within(nextDelivery).getByLabelText('Delivery date'));
    await user.type(within(nextDelivery).getByLabelText('Delivery date'), addDays(todayISO(), -6));
    await user.click(within(nextDelivery).getByRole('button', { name: 'Confirm delivery' }));
    await user.click(await screen.findByRole('button', { name: 'Start using · #2' }));
    const nextInstallation = screen.getByRole('dialog');
    await user.clear(within(nextInstallation).getByLabelText('Start / installation date'));
    await user.type(within(nextInstallation).getByLabelText('Start / installation date'), addDays(todayISO(), -5));
    await user.click(within(nextInstallation).getByRole('button', { name: 'Confirm start date' }));
    await waitFor(async () => expect((await db.cylinders.get(2))?.status).toBe('in_use'));

    expect(await screen.findByText('HP Gas / Hindustan Petroleum')).toBeInTheDocument();
    expect(screen.getByText('Low confidence')).toBeInTheDocument();
    expect(screen.getByText(formatLongDate(addDays(todayISO(), -5 + 78)))).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cylinder log' }));
    await user.selectOptions(screen.getByLabelText('Sort records'), 'finishDate');
    const edits = screen.getAllByRole('button', { name: 'Edit details' });
    await user.click(edits[0]);
    const edit = screen.getByRole('dialog');
    await user.selectOptions(within(edit).getByLabelText('Company'), 'Bharatgas / Bharat Petroleum');
    await user.clear(within(edit).getByLabelText('Actual cylinder charge'));
    await user.type(within(edit).getByLabelText('Actual cylinder charge'), '950');
    await user.clear(within(edit).getByLabelText('Actual delivery fee'));
    await user.type(within(edit).getByLabelText('Actual delivery fee'), '25');
    await user.clear(within(edit).getByLabelText('Subsidy'));
    await user.type(within(edit).getByLabelText('Subsidy'), '100');
    await user.clear(within(edit).getByLabelText('Empty / finish date'));
    await user.type(within(edit).getByLabelText('Empty / finish date'), addDays(todayISO(), 1));
    await user.click(within(edit).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('₹975')).toBeInTheDocument();

    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    await user.click(deleteButtons[0]);
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete cylinder' }));
    await waitFor(async () => expect((await db.cylinders.toArray()).map(c => c.id)).toEqual([2]));
    expect((await db.cylinders.get(2))?.company).toBe('HP Gas / Hindustan Petroleum');
  });

  it('lets the household select a primary from multiple in-use cylinders and preserves a spare', async () => {
    const started = addDays(todayISO(), -4);
    await db.cylinders.add(makeCylinder({ company: 'Indane / Indian Oil', status: 'in_use', bookingDate: addDays(started,-2), deliveryDate: addDays(started,-1), startDate: started }));
    await db.cylinders.add(makeCylinder({ company: 'HP Gas / Hindustan Petroleum', status: 'in_use', bookingDate: started, deliveryDate: started, startDate: addDays(started,1) }));
    await db.cylinders.add(makeCylinder({ company: 'Bharatgas / Bharat Petroleum', status: 'stored', bookingDate: started, deliveryDate: started }));
    const user = userEvent.setup();
    render(<App />);
    const primary = await screen.findByLabelText('Primary current cylinder');
    await user.selectOptions(primary, '1');
    expect(await screen.findByRole('heading', { name: 'Indane / Indian Oil' })).toBeInTheDocument();
    await user.selectOptions(primary, '2');
    expect(await screen.findByRole('heading', { name: 'HP Gas / Hindustan Petroleum' })).toBeInTheDocument();
    expect((await getSettings()).primaryCylinderId).toBe(2);
    expect((await db.cylinders.toArray()).filter(c=>c.status==='stored')).toHaveLength(1);
  });
});
