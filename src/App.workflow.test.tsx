import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '@/App';
import { addDays, formatLongDate, todayISO } from '@/domain/dates';
import { db, getSettings, makeCylinder } from '@/storage/database';

describe('household cylinder ledger', () => {
  beforeEach(async () => { await db.delete(); await db.open(); });
  afterEach(() => { cleanup(); db.close(); });

  it('adds a complete record, calculates totals, and finishes it with a valid duration', async () => {
    const user = userEvent.setup(); render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Add your first cylinder record' }));
    const form = within(screen.getByRole('dialog'));
    await user.type(form.getByLabelText('Cylinder charge (₹) · required'), '900');
    await user.type(form.getByLabelText('Delivery charge (₹) · required'), '30');
    await user.type(form.getByLabelText('Subsidy (optional)'), '50');
    const start = addDays(todayISO(), -40);
    await user.clear(form.getByLabelText('Start / installation date · required'));
    await user.type(form.getByLabelText('Start / installation date · required'), start);
    await user.click(form.getByRole('button', { name: 'Save cylinder record' }));
    await waitFor(async () => expect((await db.cylinders.get(1))?.status).toBe('in_use'));
    expect((await db.cylinders.get(1))?.cylinderCost).toBe(900);
    expect(await screen.findByText('₹930')).toBeInTheDocument();
    expect(screen.getAllByText('₹880')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Cylinder log' }));
    await user.click((await screen.findAllByRole('button', { name: 'Edit details' }))[0]);
    const edit=within(screen.getByRole('dialog'));
    await user.clear(edit.getByLabelText('Empty / finish date'));
    await user.type(edit.getByLabelText('Empty / finish date'), todayISO());
    await user.click(edit.getByRole('button', { name: 'Save changes' }));
    await waitFor(async () => expect((await db.cylinders.get(1))?.status).toBe('empty'));
    expect(await screen.findByText('40 days')).toBeInTheDocument();
  });

  it('blocks start dates earlier than delivery and suggests estimates from completed history', async () => {
    const started=addDays(todayISO(),-10);
    for(let i=0;i<3;i++){const start=addDays(started,-(i+1)*50); await db.cylinders.add(makeCylinder({company:'Indane / Indian Oil',status:'empty',startDate:start,deliveryDate:start,finishDate:addDays(start,42),cylinderCost:900,deliveryFee:25}));}
    const user=userEvent.setup(); render(<App />);
    await user.click(await screen.findByRole('button',{name:'＋ Add cylinder record'}));
    const form=within(screen.getByRole('dialog'));
    await user.type(form.getByLabelText('Cylinder charge (₹) · required'),'900');
    await user.type(form.getByLabelText('Delivery charge (₹) · required'),'25');
    await user.clear(form.getByLabelText('Delivery date (optional)'));
    await user.type(form.getByLabelText('Delivery date (optional)'),addDays(todayISO(),1));
    await user.clear(form.getByLabelText('Start / installation date · required'));
    await user.type(form.getByLabelText('Start / installation date · required'),todayISO());
    await user.click(form.getByRole('button',{name:'Save cylinder record'}));
    expect(await screen.findByText('Start date cannot be before delivery date.')).toBeInTheDocument();
    expect((await db.cylinders.toArray()).length).toBe(3);
    await user.clear(form.getByLabelText('Delivery date (optional)'));
    await user.type(form.getByLabelText('Delivery date (optional)'),addDays(todayISO(),-1));
    await user.click(form.getByRole('button',{name:'Save cylinder record'}));
    await waitFor(async()=>expect((await db.cylinders.toArray()).length).toBe(4));
    expect(await screen.findByText('Medium confidence')).toBeInTheDocument();
    expect(screen.getByText(formatLongDate(addDays(todayISO(),42)))).toBeInTheDocument();
  });

  it('supports multiple in-use cylinders and a stored spare', async () => {
    const started = addDays(todayISO(), -4);
    await db.cylinders.add(makeCylinder({ company: 'Indane / Indian Oil', status: 'in_use', bookingDate: addDays(started,-2), deliveryDate: addDays(started,-1), startDate: started }));
    await db.cylinders.add(makeCylinder({ company: 'HP Gas / Hindustan Petroleum', status: 'in_use', bookingDate: started, deliveryDate: started, startDate: addDays(started,1) }));
    await db.cylinders.add(makeCylinder({ company: 'Bharatgas / Bharat Petroleum', status: 'stored', bookingDate: started, deliveryDate: started }));
    const user = userEvent.setup(); render(<App />);
    const primary = await screen.findByLabelText('Primary current cylinder');
    await user.selectOptions(primary, '1'); expect(await screen.findByRole('heading', { name: 'Indane / Indian Oil' })).toBeInTheDocument();
    await user.selectOptions(primary, '2'); expect(await screen.findByRole('heading', { name: 'HP Gas / Hindustan Petroleum' })).toBeInTheDocument();
    expect((await getSettings()).primaryCylinderId).toBe(2);
    expect((await db.cylinders.toArray()).filter(c=>c.status==='stored')).toHaveLength(1);
  });
});
