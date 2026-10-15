import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { db, DEFAULT_SETTINGS, getSettings, makeCylinder, normalizeSettings, saveSettings, validateCylinder } from '@/storage/database';
import type { AppSettings, Cylinder, CylinderDraft, ReportBasis } from '@/types';
import { BUILT_IN_COMPANIES, SPECIAL_USAGES, SPECIAL_USAGE_LABELS, STATUS_LABELS, REPORT_BASIS_LABELS } from '@/types';
import { calculateDaysUsed, calculateDurationStats, calculateEstimatedCylindersPerYear, completedDurations } from '@/domain/calculations/duration';
import { calculateGrossTotal, calculateNetTotal, settledCylinders, sumFinancials } from '@/domain/calculations/financial';
import { buildPrediction, isBookingReminderDue, isEmptyReminderDue } from '@/domain/calculations/prediction';
import { calculateMonthlyMetrics } from '@/domain/analytics/monthly';
import { calculateYearlyMetrics, compareLatestYears } from '@/domain/analytics/yearly';
import { calculateCompanyMetrics } from '@/domain/analytics/company';
import { formatDays, formatLongDate, todayISO } from '@/domain/dates';
import { formatCurrency as formatMoney } from '@/domain/money';
import { parseCylindersCsv, serializeCylindersCsv } from '@/services/transfer';
import { readReceipt } from '@/services/receipt';

type Page = 'Home' | 'Cylinder log' | 'Analysis' | 'Settings';
const blankDraft = (): CylinderDraft => ({ company: BUILT_IN_COMPANIES[0], status: 'in_use', bookingDate: null, deliveryDate: null, startDate: todayISO(), finishDate: null, cylinderCost: null, deliveryFee: null, subsidy: 0, specialUsage: 'normal', notes: '', serialNumber: '', });
const NO_CYLINDERS: Cylinder[] = [];
const dateField = (v: string | null) => v ?? '';
const asNumber = (v: string) => v === '' ? null : Number(v);

export default function App() {
  const cylinders = useLiveQuery(() => db.cylinders.toArray(), [], undefined) ?? NO_CYLINDERS;
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [page, setPage] = useState<Page>('Home');
  const [dialog, setDialog] = useState<CylinderDraft | null>(null);
  const [, setFormMode] = useState<'book' | 'edit' | 'deliver' | 'start' | 'finish'>('edit');
  const [deleteTarget, setDeleteTarget] = useState<Cylinder | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formError, setFormError] = useState('');
  const [receiptMessage, setReceiptMessage] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState('all');
  const [usageFilter, setUsageFilter] = useState('all');
  const [sort, setSort] = useState('bookingDate');
  const [basis, setBasis] = useState<ReportBasis>('finish');
  const [analysisTab, setAnalysisTab] = useState<'Monthly' | 'Seasonal' | 'Company' | 'Yearly'>('Monthly');
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => { void getSettings().then(s => { setSettings(s); setBasis(s.defaultReportBasis); setReady(true); }).catch(() => { setToast('Local storage could not be opened. Your data may not persist in this browser.'); setReady(true); }); }, []);
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(''), 4200); return () => window.clearTimeout(t); }, [toast]);

  const real = useMemo(() => cylinders.filter(c => !c.isDemo), [cylinders]);
  const completed = useMemo(() => completedDurations(real), [real]);
  const stats = useMemo(() => calculateDurationStats(real), [real]);
  const inUse = useMemo(() => real.filter(c => c.startDate && !c.finishDate && c.status === 'in_use').sort((a,b) => (b.startDate ?? '').localeCompare(a.startDate ?? '')), [real]);
  const current = inUse.find(c => c.id === settings.primaryCylinderId) ?? inUse[0];
  const prediction = useMemo(() => {
    return buildPrediction({ cylinder: current ?? null, historyDurations: completed, method: settings.predictionMethod, deliveryBufferDays: settings.deliveryBufferDays, today: todayISO(), includeCurrentInAverages: settings.includeCurrentInAverages });
  }, [current, completed, settings]);
  const finances = useMemo(() => sumFinancials(settledCylinders(real)), [real]);
  const monthly = useMemo(() => calculateMonthlyMetrics(real, basis), [real, basis]);
  const yearly = useMemo(() => calculateYearlyMetrics(real, basis), [real, basis]);
  const yearComparison = useMemo(() => compareLatestYears(yearly), [yearly]);
  const company = useMemo(() => calculateCompanyMetrics(real), [real]);
  const currentAge = current?.startDate ? calculateDaysUsed({ startDate: current.startDate, finishDate: todayISO() }) : null;
  const actualThisYear = real.filter(c => c.finishDate?.slice(0,4) === String(new Date().getFullYear())).length;
  const annualEstimate = calculateEstimatedCylindersPerYear(stats.median, stats.sampleSize);
  const companies = [...new Set([...BUILT_IN_COMPANIES, ...settings.customCompanies, ...cylinders.map(c => c.company)])];

  function openNew() { setEditingId(null); setFormMode('edit'); setDialog({ ...blankDraft(), company: settings.preferredCompany }); setFormError(''); setReceiptMessage(''); }
  function openEdit(c: Cylinder) { const { id: _id, createdAt: _created, updatedAt: _updated, schemaVersion: _version, isDemo: _demo, ...draft } = c; setEditingId(c.id); setFormMode('edit'); setDialog(draft); setFormError(''); setReceiptMessage(''); }
  async function saveCylinder() {
    if (!dialog) return;
    const errors = validateCylinder(dialog);
    if (errors.length) { setFormError(errors.join(' ')); return; }
    const now = new Date().toISOString();
    const complete = { ...dialog, status: dialog.finishDate ? 'empty' as const : 'in_use' as const };
    try {
      if (editingId != null) await db.cylinders.update(editingId, { ...complete, updatedAt: now });
      else await db.cylinders.add(makeCylinder(complete));
      setDialog(null); setToast(editingId == null ? 'Cylinder record added.' : 'Cylinder details saved.');
    } catch { setFormError('Could not save this cylinder. Please try again.'); }
  }
  async function quickAction(c: Cylinder) {
    const { id: _id, createdAt: _created, updatedAt: _updated, schemaVersion: _version, isDemo: _demo, ...draft } = c;
    const next = { ...draft };
    if (c.status === 'booked') { next.deliveryDate = todayISO(); next.status = 'delivered'; setFormMode('deliver'); }
    else if (c.status === 'delivered' || c.status === 'stored') { next.startDate = todayISO(); next.status = 'in_use'; setFormMode('start'); }
    else if (c.status === 'in_use') { next.finishDate = todayISO(); next.status = 'empty'; setFormMode('finish'); }
    else return;
    setEditingId(c.id); setDialog(next); setFormError('');
  }
  async function removeCylinder(c: Cylinder) {
    setDeleteTarget(c);
  }
  async function confirmDelete() { if (!deleteTarget) return; await db.cylinders.delete(deleteTarget.id); setDeleteTarget(null); setToast('Cylinder deleted.'); }
  async function updateSettings(patch: Partial<AppSettings>) { const next = normalizeSettings({ ...settings, ...patch }); setSettings(next); await saveSettings(next); }

  function exportCsv() {
    download(new Blob([serializeCylindersCsv(real)], {type:'text/csv;charset=utf-8'}), 'lpg-cylinder-log.csv');
  }
  async function importFile(file: File, json = false) {
    try {
      const raw = await file.text();
      const parsed: unknown = json ? JSON.parse(raw) : parseCylindersCsv(raw);
      if (!Array.isArray(parsed)) throw new Error('The file must contain a list of cylinders.');
      const rows = parsed as unknown[];
      const valid: Cylinder[] = []; const errors: string[] = [];
      rows.forEach((row, i) => {
        if (typeof row !== 'object' || row === null || Array.isArray(row)) { errors.push(`Row ${i+1}: Record is malformed.`); return; }
        const record = row as Record<string, unknown>;
        const normalized: Record<string, unknown> = { ...record };
        const num = (v: unknown) => v === '' || v == null ? null : Number(v);
        normalized.cylinderCost = num(record.cylinderCost) ?? num(record.actualCylinderCost) ?? num(record.estimatedCylinderCost);
        normalized.deliveryFee = num(record.deliveryFee) ?? num(record.actualDeliveryFee) ?? num(record.estimatedDeliveryFee);
        normalized.subsidy = num(record.subsidy) ?? 0;
        for (const key of ['estimatedCylinderCost','estimatedDeliveryFee','actualCylinderCost','actualDeliveryFee']) delete normalized[key];
        for (const key of ['bookingDate','deliveryDate','startDate','finishDate']) if (record[key] === '') normalized[key] = null;
        if (typeof record.status !== 'string' || record.status === '') normalized.status = 'booked';
        if (typeof record.specialUsage !== 'string' || record.specialUsage === '') normalized.specialUsage = 'normal';
        const c = { ...makeCylinder({ company: String(record.company ?? '').trim(), bookingDate: typeof record.bookingDate === 'string' && record.bookingDate !== '' ? record.bookingDate : null, startDate: typeof record.startDate === 'string' && record.startDate !== '' ? record.startDate : null, cylinderCost: Number(normalized.cylinderCost ?? NaN), deliveryFee: Number(normalized.deliveryFee ?? NaN) }), status: 'in_use', specialUsage: 'normal', ...normalized, id: Number(record.id), isDemo: false, createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(), updatedAt: new Date().toISOString(), schemaVersion: 1 } as Cylinder;
        const issues = validateCylinder(c);
        if (issues.length || !c.company || !Number.isInteger(c.id)) errors.push(`Row ${i+1}: ${issues.join(' ') || 'Missing company or valid ID.'}`);
        else valid.push(c);
      });
      const existingIds = new Set((await db.cylinders.toArray()).map(c => c.id));
      const importIds = new Set<number>();
      const clashes = valid.filter(c => { const duplicate = existingIds.has(c.id) || importIds.has(c.id); importIds.add(c.id); return duplicate; });
      if (errors.length || clashes.length) { setToast(`${errors.slice(0,2).join(' ')}${clashes.length ? ` ${clashes.length} ID conflict(s) found; import cancelled.` : ''}`); return; }
      if (!window.confirm(`Import ${valid.length} records into this browser? Existing records are kept.`)) return;
      await db.cylinders.bulkAdd(valid); setToast(`${valid.length} cylinders imported.`);
    } catch (e) { setToast(e instanceof Error ? e.message : 'Could not read that file.'); }
  }
  async function restoreBackup(file: File) {
    try {
      const payload = JSON.parse(await file.text());
      if (!Array.isArray(payload.cylinders)) throw new Error('This backup does not contain a cylinder list.');
      const data = payload.cylinders as Cylinder[];
      if (data.some(c => typeof c !== 'object' || c === null || Array.isArray(c))) throw new Error('This backup contains a malformed cylinder record.');
      const failures = data.flatMap((c,i) => { const e=validateCylinder(c); return e.length ? [`Record ${i+1}: ${e.join(' ')}`] : []; });
      if (failures.length) throw new Error(failures[0]);
      if (new Set(data.map(c=>c.id)).size !== data.length) throw new Error('This backup contains duplicate cylinder IDs.');
      const restoredSettings = payload.settings ? normalizeSettings(payload.settings) : null;
    const replace = window.confirm('Restore backup by replacing all cylinder records? Choose Cancel to review a separate merge confirmation.');
      if (!replace && !window.confirm('Merge these cylinders with your existing records using new internal IDs?')) return;
      if (replace) { await db.transaction('rw', db.cylinders, db.settings, async () => { await db.cylinders.clear(); await db.cylinders.bulkAdd(data); if(restoredSettings) await db.settings.put(restoredSettings); }); }
      else { const all=await db.cylinders.toArray(); let id=Math.max(0,...all.map(c=>c.id))+1; await db.cylinders.bulkAdd(data.map(c=>({...c,id:id++}))); }
      if(replace && restoredSettings) setSettings(await getSettings()); setToast(`Backup restored: ${data.length} cylinders.`);
    } catch(e) { setToast(e instanceof Error ? e.message : 'Backup could not be restored.'); }
  }

  const filtered = [...cylinders].filter(c => (search === '' || `${c.company} ${c.notes} ${c.serialNumber}`.toLowerCase().includes(search.toLowerCase())) && (statusFilter === 'all' || c.status === statusFilter) && (usageFilter === 'all' || c.specialUsage === usageFilter) && (yearFilter === 'all' || (c.bookingDate ?? '').startsWith(yearFilter)) && (monthFilter === 'all' || (c.bookingDate ?? '').slice(5,7) === monthFilter)).sort((a,b) => {
    if(sort==='duration') return (calculateDaysUsed(b)??-1)-(calculateDaysUsed(a)??-1);
    if(sort==='cost') return calculateGrossTotal(b)-calculateGrossTotal(a);
    return String((b as unknown as Record<string,unknown>)[sort]??'').localeCompare(String((a as unknown as Record<string,unknown>)[sort]??''));
  });
  const years = [...new Set(cylinders.map(c=>c.bookingDate?.slice(0,4)).filter(Boolean))].sort().reverse();
  const months = [...new Set(cylinders.map(c=>c.bookingDate?.slice(5,7)).filter(Boolean))].sort();

  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="#home" onClick={e=>{e.preventDefault();setPage('Home')}}><span className="brand-mark">◉</span><span><b>Flame</b><small>HOUSEHOLD LPG LOG</small></span></a><nav aria-label="Main navigation" className="desktop-nav">{(['Home','Cylinder log','Analysis','Settings'] as Page[]).map(p=><button key={p} className={page===p?'nav-active':''} onClick={()=>setPage(p)}>{p}</button>)}</nav><button className="primary top-action" onClick={openNew}>＋ <span>Add cylinder</span></button></header>
    <main className="content">{!ready ? <div className="loading">Opening your private cylinder log…</div> : <>
      {page==='Home' && <>
        <div className="page-heading"><div><p className="eyebrow">{settings.householdName ? `${settings.householdName.toUpperCase()} · ` : ''}HOUSEHOLD OVERVIEW</p><h1>Your LPG, in hand.</h1><p className="muted">A clear picture of what’s running and what’s next.</p></div><button className="primary desktop-only" onClick={openNew}>＋ Add cylinder record</button></div>
        {real.length===0 ? <section className="empty-hero"><span className="empty-icon">◉</span><h2>No LPG history yet.</h2><p>Add a refill record. Your data stays in this browser.</p><button className="primary" onClick={openNew}>Add your first cylinder record</button></section> : <>
      {settings.missingInfoRemindersEnabled && (real.some(c=>c.status==='delivered'&&!c.startDate) || real.some(c=>c.status==='empty'&&!c.finishDate)) && <div className="notice">A cylinder is missing a lifecycle date. <button onClick={()=>setPage('Cylinder log')}>Review log →</button></div>}
          {settings.bookingRemindersEnabled && prediction.available && isBookingReminderDue(prediction.suggestedBookingDate,settings.bookingReminderLeadDays) && <div className="notice">Booking reminder: consider booking around {formatLongDate(prediction.suggestedBookingDate)}. <span>Estimate only.</span></div>}
      {settings.emptyRemindersEnabled && prediction.available && isEmptyReminderDue(prediction.predictedEmptyDate,settings.emptyReminderLeadDays) && <div className="notice">Your current cylinder may be nearing empty around {formatLongDate(prediction.predictedEmptyDate)}. This is an estimate.</div>}
          <section className="current-card"><div className="current-top"><div><span className="pill live">● CURRENT CYLINDER</span><h2>{current ? current.company : 'No cylinder in use'}</h2><p>{current?.startDate ? `Started ${formatLongDate(current.startDate)}${inUse.length>1?' · More than one cylinder is marked in use':''}` : 'Start a delivered cylinder to see its estimate here.'}</p></div>{inUse.length>1&&<label className="primary-cylinder"><span>Featured cylinder</span><select aria-label="Primary current cylinder" value={current?.id??''} onChange={e=>void updateSettings({primaryCylinderId:Number(e.target.value)})}>{inUse.map(c=><option key={c.id} value={c.id}>{c.company} · #{c.id}</option>)}</select></label>}{current&&<div className="age"><strong>{currentAge??'—'}</strong><span>days running</span></div>}</div>
            {current && <div className="prediction-row">{prediction.available ? <><div><span>ESTIMATED EMPTY</span><b>{formatLongDate(prediction.predictedEmptyDate)}</b></div><div><span>BOOK AROUND</span><b>{formatLongDate(prediction.suggestedBookingDate)}</b></div><div><span>EST. REMAINING</span><b>{formatDays(prediction.estimatedDaysRemaining)}</b></div><div><span>CONFIDENCE</span><b>{prediction.confidence==='low'?'Low confidence':prediction.confidence==='medium'?'Medium confidence':'High confidence'}</b></div></> : <p className="muted">{prediction.unavailableReason}</p>}</div>}
            {prediction.available && <details className="workings"><summary>How we estimated this</summary><p>{prediction.workings.join(' · ')}</p><small>Predictions are estimates, not guarantees.</small></details>}
          </section>
          <div className="section-title"><div><p className="eyebrow">AT A GLANCE</p><h2>The household picture</h2></div><button className="text-button" onClick={()=>setPage('Analysis')}>See analysis →</button></div>
          <div className="metric-grid"><Metric label="Finished this year" value={String(actualThisYear)} hint="Actual completed cylinders"/><Metric label="Average duration" value={stats.median==null?'—':formatDays(stats.median)} hint={`${stats.sampleSize} completed cycles · median`}/><Metric label="Est. cylinders / year" value={annualEstimate==null?'—':annualEstimate.toFixed(1)} hint="Based on completed duration"/><Metric label="Shortest · longest" value={stats.shortest==null?'—':`${stats.shortest.days} · ${stats.longest?.days} days`} hint="Completed cylinders"/></div>
          <div className="section-title"><div><p className="eyebrow">SPENDING</p><h2>What you’ve paid</h2></div></div><div className="metric-grid costs"><Metric label="Cylinder charges" value={formatMoney(finances.cylinderCharges,'INR')}/><Metric label="Delivery fees" value={formatMoney(finances.deliveryFees,'INR')}/><Metric label="Gross expenditure" value={formatMoney(finances.gross,'INR')}/><Metric label="Subsidy" value={formatMoney(finances.subsidy,'INR')}/><Metric label="Net expenditure" value={formatMoney(finances.net,'INR')}/><Metric label="Avg. net / cylinder" value={finances.averageNet==null?'—':formatMoney(finances.averageNet,'INR')}/></div>
          <ChartCard title="Consumption trend" subtitle="Cylinder finishes by month"><TrendChart data={monthly.months.map(m=>({label:m.label,value:m.completedCount}))} color="#208b70" unit="cylinders"/></ChartCard>
          <section className="next-actions"><div><p className="eyebrow">UP NEXT</p><h2>Keep your log current</h2><p className="muted">A quick update helps keep your estimates useful.</p></div><div className="action-buttons">{cylinders.filter(c=>!c.isDemo&&c.status!=='empty'&&c.status!=='returned').slice(0,2).map(c=><button key={c.id} className="secondary" onClick={()=>quickAction(c)}>{c.status==='booked'?'Mark delivered':c.status==='delivered'||c.status==='stored'?'Start using':'Mark empty'} · #{c.id}</button>)}</div></section>
        </>}
      </>}
      {page==='Cylinder log' && <><div className="page-heading"><div><p className="eyebrow">YOUR RECORDS</p><h1>Cylinder log</h1><p className="muted">A simple record of each refill cycle.</p></div><button className="primary" onClick={openNew}>＋ Add cylinder record</button></div><div className="toolbar"><input aria-label="Search cylinders" placeholder="Search company, notes, serial…" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="Filter by status" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">All statuses</option>{Object.entries(STATUS_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select><select aria-label="Filter by year" value={yearFilter} onChange={e=>setYearFilter(e.target.value)}><option value="all">All years</option>{years.map(y=><option key={y}>{y}</option>)}</select><select aria-label="Filter by month" value={monthFilter} onChange={e=>setMonthFilter(e.target.value)}><option value="all">All months</option>{months.map(m=><option key={m} value={m}>{new Intl.DateTimeFormat('en',{month:'long'}).format(new Date(2020,Number(m)-1,1))}</option>)}</select><select aria-label="Filter by special usage" value={usageFilter} onChange={e=>setUsageFilter(e.target.value)}><option value="all">All usage</option>{SPECIAL_USAGES.map(s=><option key={s} value={s}>{SPECIAL_USAGE_LABELS[s]}</option>)}</select><select aria-label="Sort records" value={sort} onChange={e=>setSort(e.target.value)}><option value="bookingDate">Booking date</option><option value="deliveryDate">Delivery date</option><option value="startDate">Start date</option><option value="finishDate">Empty date</option><option value="duration">Duration</option><option value="cost">Cost</option><option value="company">Company</option></select></div>
        {!filtered.length ? <section className="empty-card"><h2>{cylinders.length?'No matching cylinders':'No cylinders yet'}</h2><p className="muted">{cylinders.length?'Try changing your search or filters.':'Add a cylinder record to begin your log.'}</p>{!cylinders.length&&<button className="primary" onClick={openNew}>Add cylinder record</button>}</section> : <div className="record-list">{filtered.map(c=><article className="record" key={c.id}><div className="record-main"><div><span className={`pill status-${c.status}`}>{STATUS_LABELS[c.status]}</span><h3>{c.company} <small>· #{c.id}</small></h3><p className="muted">Booked {formatLongDate(c.bookingDate ?? c.startDate ?? todayISO())}{c.startDate?` · Started ${formatLongDate(c.startDate)}`:''}{c.finishDate?` · Empty ${formatLongDate(c.finishDate)}`:''}</p></div><div className="record-cost"><b>{formatMoney(calculateGrossTotal(c),'INR')}</b><small>gross · net {formatMoney(calculateNetTotal(c),'INR')}</small>{c.finishDate&&c.startDate&&<small>{formatDays(calculateDaysUsed(c))}</small>}</div></div>{c.notes&&<p className="record-note">{c.notes}</p>}<div className="record-actions"><button className="secondary" onClick={()=>openEdit(c)}>Edit details</button>{c.status!=='empty'&&c.status!=='returned'&&<button className="secondary" onClick={()=>quickAction(c)}>{c.status==='booked'?'Mark delivered':c.status==='delivered'||c.status==='stored'?'Start using':'Mark empty'}</button>}<button className="danger-link" onClick={()=>removeCylinder(c)}>Delete</button></div></article>)}</div>}
      </>}
      {page==='Analysis' && <><div className="page-heading"><div><p className="eyebrow">REAL HOUSEHOLD DATA</p><h1>Analysis</h1><p className="muted">Patterns emerge as your history grows.</p></div></div><div className="tab-row">{(['Monthly','Seasonal','Company','Yearly'] as const).map(t=><button key={t} className={analysisTab===t?'tab-selected':''} onClick={()=>setAnalysisTab(t)}>{t}</button>)}</div><div className="basis-control"><label>Group records by <select value={basis} onChange={e=>setBasis(e.target.value as ReportBasis)}>{Object.entries(REPORT_BASIS_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><span>All totals use this date basis.</span></div>
        {real.length === 0 ? (
          <section className="empty-card"><h2>No LPG history yet.</h2><p className="muted">Analysis appears here after you start recording cylinders.</p></section>
        ) : analysisTab === 'Monthly' ? (
          <>
            <ChartCard title="Monthly consumption" subtitle={`Completed cylinders by ${REPORT_BASIS_LABELS[basis].toLowerCase()}`}><TrendChart data={monthly.months.map(m=>({label:m.label,value:m.completedCount}))} color="#208b70" unit="cylinders"/></ChartCard>
            <ChartCard title="Monthly spending" subtitle="Net expenditure · delivered cylinders"><TrendChart data={monthly.months.map(m=>({label:m.label,value:m.financial.net}))} color="#d88746" unit={'INR'}/></ChartCard>
            <ChartCard title="Average cylinder duration" subtitle="Completed cylinders grouped by the selected date basis"><TrendChart data={monthly.months.filter(m=>m.averageDurationDays!=null).map(m=>({label:m.label,value:m.averageDurationDays!}))} color="#5979bb" unit="days"/></ChartCard>
            <MetricTable headers={['Month','Finished','Avg. duration','Cylinder charges','Delivery','Gross','Subsidy','Net']} rows={monthly.months.map(m=>[m.label,String(m.completedCount),formatDays(m.averageDurationDays),formatMoney(m.financial.cylinderCharges,'INR'),formatMoney(m.financial.deliveryFees,'INR'),formatMoney(m.financial.gross,'INR'),formatMoney(m.financial.subsidy,'INR'),formatMoney(m.financial.net,'INR')])}/>
          </>
        ) : analysisTab === 'Yearly' ? (
          <>
            <ChartCard title="Annual cylinder use" subtitle="Completed cycles by reporting year"><BarTrendChart data={yearly.years.map(y=>({label:String(y.year),value:y.completedCount}))} color="#5979bb" unit="cylinders"/></ChartCard>
            {yearComparison && <div className="year-comparison">{yearComparison.previous.year} → {yearComparison.latest.year}: {yearComparison.cylinderDelta > 0 ? '+' : ''}{yearComparison.cylinderDelta} cylinders · Net spending {yearComparison.netDelta > 0 ? '+' : '−'}{formatMoney(Math.abs(yearComparison.netDelta),'INR')}</div>}
            <MetricTable headers={['Year','Cylinders','Avg. duration','Cylinder charges','Delivery','Gross','Subsidy','Net']} rows={yearly.years.map(y=>[String(y.year),String(y.completedCount),formatDays(y.averageDurationDays),formatMoney(y.financial.cylinderCharges,'INR'),formatMoney(y.financial.deliveryFees,'INR'),formatMoney(y.financial.gross,'INR'),formatMoney(y.financial.subsidy,'INR'),formatMoney(y.financial.net,'INR')])}/>
          </>
        ) : analysisTab === 'Company' ? (
          <>
            <ChartCard title="Company comparison" subtitle="Net expenditure · requires three completed cylinders per company"><BarTrendChart data={company.companies.filter(c=>c.comparable).map(c=>({label:c.company,value:c.financial.net}))} color="#5979bb" unit={'INR'}/></ChartCard>
            <MetricTable headers={['Company','Cycles','Avg. duration','Cylinder charges','Delivery','Gross','Subsidy','Net','Avg. net']} rows={company.companies.map(c=>[c.company,String(c.cylinderCount),formatDays(c.comparable?c.averageDurationDays:null),formatMoney(c.financial.cylinderCharges,'INR'),formatMoney(c.financial.deliveryFees,'INR'),formatMoney(c.financial.gross,'INR'),formatMoney(c.financial.subsidy,'INR'),formatMoney(c.financial.net,'INR'),formatMoney(c.comparable?c.financial.averageNet:null,'INR')])}/>
            <p className="muted footnote">Company comparisons describe your records and don’t indicate which provider is better. Small samples are limited.</p>
          </>
        ) : <SeasonalView cylinders={real}/>}
      </>}
      {page==='Settings' && <><div className="page-heading"><div><p className="eyebrow">YOUR PREFERENCES</p><h1>Settings</h1><p className="muted">Your household details stay in this browser.</p></div></div><div className="settings-grid"><section className="settings-card"><h2>Household</h2><Field label="Household name"><input value={settings.householdName} onChange={e=>void updateSettings({householdName:e.target.value})}/></Field></section><section className="settings-card"><h2>Refill preferences</h2><Field label="Preferred company"><select value={settings.preferredCompany} onChange={e=>void updateSettings({preferredCompany:e.target.value})}>{companies.map(c=><option key={c}>{c}</option>)}</select></Field><Field label="Add a company"><CompanyAdder companies={settings.customCompanies} onAdd={async c=>{if(!companies.includes(c)) await updateSettings({customCompanies:[...settings.customCompanies,c]})}}/></Field><Field label="Delivery buffer · days"><input type="text" inputMode="numeric" value={settings.deliveryBufferDays} onChange={e=>void updateSettings({deliveryBufferDays:Number(e.target.value)})}/></Field><Field label="Prediction method"><select value={settings.predictionMethod} onChange={e=>void updateSettings({predictionMethod:e.target.value as AppSettings['predictionMethod']})}><option value="median">Median · robust</option><option value="mean">Mean</option><option value="weighted">Weighted average</option></select></Field><Field label="Report date basis"><select value={basis} onChange={e=>{setBasis(e.target.value as ReportBasis); void updateSettings({defaultReportBasis:e.target.value as ReportBasis})}}>{Object.entries(REPORT_BASIS_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></Field></section><section className="settings-card"><h2>Reminders</h2><label className="toggle"><input type="checkbox" checked={settings.bookingRemindersEnabled} onChange={e=>void updateSettings({bookingRemindersEnabled:e.target.checked})}/> In-app booking reminder</label><Field label="Show before suggested booking · days"><input type="text" inputMode="numeric" value={settings.bookingReminderLeadDays} onChange={e=>void updateSettings({bookingReminderLeadDays:Number(e.target.value)})}/></Field><label className="toggle"><input type="checkbox" checked={settings.emptyRemindersEnabled} onChange={e=>void updateSettings({emptyRemindersEnabled:e.target.checked})}/> In-app estimated-empty reminder</label><Field label="Show before estimate · days"><input type="text" inputMode="numeric" value={settings.emptyReminderLeadDays} onChange={e=>void updateSettings({emptyReminderLeadDays:Number(e.target.value)})}/></Field><p className="muted small">Reminders appear in the app while it is open. Background notifications aren’t enabled.</p></section><section className="settings-card"><h2>Data & privacy</h2><p className="muted">Records stay in this browser’s IndexedDB. This app does not create an account or upload household records. Browser storage is not encrypted by the app; use a device passcode and keep exported backups private. Receipt reading happens on this device; its language model may download when first used, but the receipt itself is not uploaded.</p><div className="data-actions"><button className="secondary" onClick={exportCsv}>Export CSV</button><label className="secondary file-button">Import CSV<input type="file" accept=".csv,text/csv" onChange={e=>e.target.files?.[0]&&void importFile(e.target.files[0])}/></label><button className="secondary" onClick={()=>download(new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),settings,cylinders},null,2)],{type:'application/json'}),'lpg-backup.json')}>Download backup</button><label className="secondary file-button">Restore backup<input type="file" accept="application/json,.json" onChange={e=>e.target.files?.[0]&&void restoreBackup(e.target.files[0])}/></label></div></section></div></>}
    </>}</main>
    <nav className="mobile-nav" aria-label="Mobile navigation">{(['Home','Cylinder log','Analysis','Settings'] as Page[]).map((p,i)=><button key={p} className={page===p?'nav-active':''} onClick={()=>setPage(p)}><span>{['⌂','▤','◷','⚙'][i]}</span>{p==='Cylinder log'?'Log':p}</button>)}</nav>
    {dialog && <div className="modal-backdrop" role="presentation" onMouseDown={e=>e.target===e.currentTarget&&setDialog(null)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="form-title"><header><div><p className="eyebrow">CYLINDER DETAILS</p><h2 id="form-title">{editingId == null ? 'Add cylinder record' : 'Edit cylinder record'}</h2></div><button className="close" aria-label="Close" onClick={()=>setDialog(null)}>×</button></header><div className="form-grid"><Field label="Company · required"><select value={dialog.company} onChange={e=>setDialog({...dialog,company:e.target.value})}>{companies.map(c=><option key={c}>{c}</option>)}</select></Field><Field label="Booking date (optional)"><input type="date" value={dateField(dialog.bookingDate)} onChange={e=>setDialog({...dialog,bookingDate:e.target.value||null})}/></Field><Field label="Delivery date (optional)"><input type="date" min={dateField(dialog.bookingDate)} value={dateField(dialog.deliveryDate)} onChange={e=>setDialog({...dialog,deliveryDate:e.target.value||null})}/></Field><Field label="Start / installation date · required"><input required type="date" min={dateField(dialog.deliveryDate)} value={dateField(dialog.startDate)} onChange={e=>setDialog({...dialog,startDate:e.target.value||null})}/></Field><Field label="Empty / finish date"><input type="date" min={dateField(dialog.startDate)} value={dateField(dialog.finishDate)} onChange={e=>setDialog({...dialog,finishDate:e.target.value||null})}/></Field><Field label="Cylinder charge (₹) · required"><input type="text" inputMode="decimal" required value={dialog.cylinderCost??''} onChange={e=>setDialog({...dialog,cylinderCost:asNumber(e.target.value)})}/></Field><Field label="Delivery charge (₹) · required"><input type="text" inputMode="decimal" required value={dialog.deliveryFee??''} onChange={e=>setDialog({...dialog,deliveryFee:asNumber(e.target.value)})}/></Field><Field label="Subsidy (optional)"><input type="text" inputMode="decimal" value={dialog.subsidy||''} onChange={e=>setDialog({...dialog,subsidy:asNumber(e.target.value)??0})}/></Field><Field label="Physical serial number"><input value={dialog.serialNumber} onChange={e=>setDialog({...dialog,serialNumber:e.target.value})}/></Field><Field label="Special usage"><select value={dialog.specialUsage} onChange={e=>setDialog({...dialog,specialUsage:e.target.value as Cylinder['specialUsage']})}>{SPECIAL_USAGES.map(s=><option key={s} value={s}>{SPECIAL_USAGE_LABELS[s]}</option>)}</select></Field><Field label="Notes"><textarea rows={2} value={dialog.notes} onChange={e=>setDialog({...dialog,notes:e.target.value})}/></Field><Field label="Receipt photo or PDF (optional)"><input type="file" accept="image/*,application/pdf,.pdf" onChange={e=>{const file=e.target.files?.[0];if(file) void readReceipt(file).then(result=>{setDialog(d=>d?{...d,...result.fields}:d);setReceiptMessage(result.message)}).catch(()=>setReceiptMessage('Could not read this receipt. Enter the details manually.'))}}/></Field></div>{receiptMessage&&<p className="muted small" role="status">{receiptMessage}</p>}{formError&&<p className="form-error" role="alert">{formError}</p>}<p className="muted small">Gross total: ₹{calculateGrossTotal(dialog).toFixed(2)} · Net after subsidy: ₹{calculateNetTotal(dialog).toFixed(2)}. Start date and both charges are required; subsidy is optional.</p><footer><button className="secondary" onClick={()=>setDialog(null)}>Cancel</button><button className="primary" onClick={()=>void saveCylinder()}>{editingId == null ? 'Save cylinder record' : 'Save changes'}</button></footer></section></div>}
    {deleteTarget&&<div className="modal-backdrop" role="presentation" onMouseDown={e=>e.target===e.currentTarget&&setDeleteTarget(null)}><section className="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="delete-title"><p className="eyebrow">REMOVE RECORD</p><h2 id="delete-title">Delete cylinder #{deleteTarget.id}?</h2><p className="muted">This removes the {deleteTarget.company} record from this device. This cannot be undone.</p><footer><button className="secondary" onClick={()=>setDeleteTarget(null)}>Keep record</button><button className="delete-button" onClick={()=>void confirmDelete()}>Delete cylinder</button></footer></section></div>}
    {toast&&<div className="toast" role="status">{toast}</div>}
  </div>;
}

function Metric({label,value,hint}:{label:string;value:string;hint?:string}){return <article className="metric"><span>{label}</span><strong>{value}</strong>{hint&&<small>{hint}</small>}</article>}
function Field({label,children}:{label:string;children:ReactNode}){return <label className="field"><span>{label}</span>{children}</label>}
function ChartCard({title,subtitle,children}:{title:string;subtitle:string;children?:ReactNode}){return <section className="chart-card"><div className="chart-title"><div><h3>{title}</h3><p>{subtitle}</p></div></div>{children}</section>}
function TrendChart({data,color,unit}:{data:{label:string;value:number}[];color:string;unit:string}){const useful=data.filter(d=>d.value!==0);if(useful.length<2)return <div className="chart-empty">Not enough historical data yet. Add a few more records to see a trend.</div>;return <div className="chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{top:8,right:12,left:0,bottom:0}}><defs><linearGradient id={`fill-${color.slice(1)}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={.18}/><stop offset="95%" stopColor={color} stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e9ebe7"/><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{fontSize:11,fill:'#777e77'}}/><YAxis tickLine={false} axisLine={false} tick={{fontSize:11,fill:'#777e77'}} width={42}/><Tooltip formatter={(v)=>[`${v} ${unit}`,unit]}/><Area type="monotone" dataKey="value" stroke={color} fill={`url(#fill-${color.slice(1)})`} strokeWidth={2.5} dot={{r:3,fill:color}}/></AreaChart></ResponsiveContainer></div>}
function BarTrendChart({data,color,unit}:{data:{label:string;value:number}[];color:string;unit:string}){const useful=data.filter(d=>d.value!==0);if(useful.length<2)return <div className="chart-empty">Not enough historical data yet. Two or more meaningful data points are needed for comparison.</div>;return <div className="chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{top:8,right:12,left:0,bottom:0}}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e9ebe7"/><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{fontSize:11,fill:'#777e77'}}/><YAxis tickLine={false} axisLine={false} tick={{fontSize:11,fill:'#777e77'}} width={42}/><Tooltip formatter={(v)=>[`${v} ${unit}`,unit]}/><Bar dataKey="value" name={unit} fill={color} radius={[6,6,0,0]}/></BarChart></ResponsiveContainer></div>}
function MetricTable({headers,rows}:{headers:string[];rows:string[][]}){return rows.length?<div className="table-wrap"><table><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j}>{c}</td>)}</tr>)}</tbody></table></div>:<div className="chart-empty">Not enough historical data yet.</div>}
function SeasonalView({cylinders}:{cylinders:Cylinder[]}){
  const analysis=useMemo(()=>{const done=cylinders.filter(c=>c.startDate&&c.finishDate);const years=new Set(done.map(c=>c.startDate!.slice(0,4)));if(done.length<3||years.size<2)return{values:[],supported:false};const values=Array.from({length:12},(_,i)=>{const month=i+1;const samples=done.filter(c=>Number(c.startDate?.slice(5,7))===month);return{label:new Intl.DateTimeFormat('en',{month:'short'}).format(new Date(2020,month-1,1)),value:samples.length?samples.reduce((a,c)=>a+calculateDaysUsed(c)!,0)/samples.length:0,count:samples.length};}).filter(x=>x.count>0);return{values,supported:values.length>=3};},[cylinders]);
  const {values,supported}=analysis;const highest=values.reduce((a,b)=>b.value<a.value?b:a,values[0]);const lowest=values.reduce((a,b)=>b.value>a.value?b:a,values[0]);
  return !supported?<section className="empty-card"><h2>Not enough historical data yet.</h2><p className="muted">Seasonal patterns need at least three completed cylinders across multiple years and months.</p></section>:<><p className="muted">This compares average completed-cylinder duration by start month across years. Shorter durations suggest higher use. Special-use entries remain included.</p><div className="metric-grid"><Metric label="Higher-use month" value={highest.label} hint={`${formatDays(highest.value)} average duration`}/><Metric label="Lower-use month" value={lowest.label} hint={`${formatDays(lowest.value)} average duration`}/></div><ChartCard title="Average duration by start month" subtitle="Across completed cylinders; special-use records remain included"><TrendChart data={values.map(v=>({label:v.label,value:Math.round(v.value)}))} color="#208b70" unit="days"/></ChartCard><MetricTable headers={['Month','Average duration','Completed cycles']} rows={values.map(v=>[v.label,formatDays(v.value),String(v.count)])}/></>;
}
function CompanyAdder({companies,onAdd}:{companies:string[];onAdd:(v:string)=>void}){const [value,setValue]=useState('');return <div className="inline-add"><input value={value} onChange={e=>setValue(e.target.value)} placeholder="Company name"/><button className="secondary" onClick={()=>{const v=value.trim();if(v&&!companies.includes(v)){onAdd(v);setValue('')}}}>Add</button></div>}
function download(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
