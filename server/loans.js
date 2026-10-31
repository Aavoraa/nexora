// Loan reminders (PRD Feature 12): customers, groups, loans with instalment schedules,
// automatic due-date reminders and manual messages over SMS, WhatsApp or email.
import express from 'express';
import { many, one, pool, tx, logActivity } from './db.js';
import { requireRole } from './auth.js';
import { zonedParts } from './time.js';

export const loans = express.Router();

const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const fail = (status, message) => { throw Object.assign(new Error(message), { status, expose: true }); };
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const intId = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : fail(400, 'Invalid id'));
const bool = (v) => v === true;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_RE = /^\+?[0-9 ()-]{6,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const CHANNELS = ['sms', 'whatsapp', 'email'];

/**
 * Which messaging providers are connected. None are yet (PRD F12): every message is
 * recorded as "simulated" until a provider adapter is added here.
 */
export function channelStatus() {
  return { sms: false, whatsapp: false, email: false };
}

// ---------- dates & money ----------

export function todayIn(timeZone, now = new Date()) {
  const p = zonedParts(now, timeZone);
  return `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}
const toUtc = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fromUtc = (t) => new Date(t).toISOString().slice(0, 10);
export const addDays = (s, n) => fromUtc(toUtc(s) + n * 86400_000);
export const daysBetween = (a, b) => Math.round((toUtc(b) - toUtc(a)) / 86400_000);

/** Same day-of-month `n` months later, clamped to the month's last day (31 Jan → 28/29 Feb). */
export function addMonths(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(y, m - 1 + n, Math.min(d, last)));
}

export function schedule(firstDue, count, frequency) {
  return Array.from({ length: count }, (_, i) => (frequency === 'weekly' ? addDays(firstDue, 7 * i) : addMonths(firstDue, i)));
}

const money = (amount, currency) => {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${Number(amount).toFixed(2)}`;
  }
};
const prettyDate = (s) => new Date(`${s}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// ---------- messages ----------

/** Fill {name}, {amount}, {due_date}, {loan}, {company} placeholders. Unknown ones are left as they are. */
export function render(template, vars) {
  return template.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}

/**
 * Decide what happens to one message: skipped (no consent, opted out, no address),
 * simulated (no provider connected) or, once providers exist, sent/failed.
 */
export function deliveryFor(customer, channel, body) {
  const address = channel === 'email' ? customer.email : customer.phone;
  let text = body;
  // Text channels always carry an opt-out instruction.
  if (channel !== 'email' && !/\bSTOP\b/.test(text)) text = `${text} Reply STOP to opt out.`;
  if (customer.opted_out_at) return { status: 'skipped', reason: 'Customer opted out', address, text };
  if (!customer[`consent_${channel}`]) return { status: 'skipped', reason: `No ${channel === 'sms' ? 'SMS' : channel === 'whatsapp' ? 'WhatsApp' : 'email'} consent`, address, text };
  if (!address) return { status: 'skipped', reason: channel === 'email' ? 'No email address' : 'No phone number', address, text };
  if (!channelStatus()[channel]) return { status: 'simulated', reason: 'Channel not set up: logged, not delivered', address, text };
  return { status: 'sent', reason: '', address, text };
}

async function recordMessage(c, { workspaceId, customer, installmentId = null, sentBy = null, kind, channel, body, ruleKey = null }) {
  const d = deliveryFor(customer, channel, body);
  const { rows } = await c.query(`
    INSERT INTO loan_messages (workspace_id, customer_id, installment_id, sent_by, kind, channel, to_address, body, status, reason, rule_key)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (rule_key) DO NOTHING RETURNING id, status`,
  [workspaceId, customer.id, installmentId, sentBy, kind, channel, d.address, d.text, d.status, d.reason, ruleKey]);
  return rows[0] || null;
}

// ---------- reminder engine ----------

/**
 * Create due reminders for every workspace with reminders on. Each reminder has a
 * unique rule_key, so running this repeatedly (or on several servers) never duplicates.
 * @returns {Promise<number>} messages created
 */
export async function runReminders(now = new Date(), onlyWorkspaceId = null) {
  const workspaces = await many(`
    SELECT w.id, w.name, w.timezone, w.currency, r.*
    FROM workspaces w JOIN reminder_rules r ON r.workspace_id = w.id
    WHERE w.loans_enabled AND r.enabled ${onlyWorkspaceId ? 'AND w.id = $1' : ''}`, onlyWorkspaceId ? [onlyWorkspaceId] : []);
  let created = 0;
  for (const ws of workspaces) {
    const today = todayIn(ws.timezone, now);
    const ahead = Math.max(0, ...ws.days_before);
    // Customer columns as-is (c.*), instalment columns under their own names.
    const due = await many(`
      SELECT c.*, i.id AS installment_id, i.due_date, i.amount, l.reference
      FROM loan_installments i
      JOIN loans l ON l.id = i.loan_id AND l.status = 'active'
      JOIN loan_customers c ON c.id = l.customer_id
      WHERE l.workspace_id = $1 AND i.paid_at IS NULL AND i.due_date BETWEEN $2::date AND $3::date`,
    [ws.workspace_id, addDays(today, -90), addDays(today, ahead)]);
    for (const row0 of due) {
      const inst = row0.installment_id;
      const diff = daysBetween(today, row0.due_date);
      let kind = null;
      let key = null;
      if (diff > 0 && ws.days_before.includes(diff)) { kind = 'before'; key = `${inst}:before:${diff}`; }
      else if (diff === 0 && ws.on_due_day) { kind = 'due'; key = `${inst}:due`; }
      else if (diff < 0 && ws.overdue_every > 0 && (-diff) % ws.overdue_every === 0) { kind = 'overdue'; key = `${inst}:overdue:${today}`; }
      if (!kind) continue;
      const body = render(ws[`template_${kind}`], {
        name: row0.name.split(/\s+/)[0], amount: money(row0.amount, ws.currency), due_date: prettyDate(row0.due_date),
        loan: row0.reference, company: ws.name,
      });
      const row = await recordMessage(pool, {
        workspaceId: ws.workspace_id, customer: row0, installmentId: inst, kind, channel: ws.channel, body, ruleKey: key,
      });
      if (row) created += 1;
    }
  }
  return created;
}

export function startReminders(intervalMs = 10 * 60_000) {
  const tick = () => runReminders().catch((err) => console.error('[reminders]', err));
  tick();
  return setInterval(tick, intervalMs);
}

// ---------- access ----------

/** Loads the workspace and refuses when loan reminders are switched off. */
loans.use(ah(async (req, res, next) => {
  const ws = await one('SELECT id, name, timezone, currency, loans_enabled FROM workspaces WHERE id = $1', [req.user.workspace_id]);
  if (!ws.loans_enabled) return res.status(403).json({ error: 'Loan reminders are not switched on for this workspace. An admin can turn them on in Settings.', code: 'loans_disabled' });
  req.ws = ws;
  req.today = todayIn(ws.timezone);
  next();
}));

async function customerFor(req, id) {
  return (await one('SELECT * FROM loan_customers WHERE id = $1 AND workspace_id = $2', [id, req.ws.id])) || fail(404, 'Customer not found');
}
async function groupFor(req, id) {
  if (id === null || id === undefined || id === '') return null;
  return (await one('SELECT * FROM loan_groups WHERE id = $1 AND workspace_id = $2', [intId(id), req.ws.id])) || fail(400, 'Group not found');
}
async function rulesFor(wsId) {
  await pool.query('INSERT INTO reminder_rules (workspace_id) VALUES ($1) ON CONFLICT DO NOTHING', [wsId]);
  return one('SELECT * FROM reminder_rules WHERE workspace_id = $1', [wsId]);
}

// ---------- overview ----------

loans.get('/overview', ah(async (req, res) => {
  const wsId = req.ws.id;
  const t = req.today;
  const [counts, upcoming, rules] = await Promise.all([
    one(`SELECT
      (SELECT count(*) FROM loan_customers WHERE workspace_id = $1) AS customers,
      (SELECT count(*) FROM loans WHERE workspace_id = $1 AND status = 'active') AS active_loans,
      (SELECT count(*) FROM loan_installments i JOIN loans l ON l.id = i.loan_id
        WHERE l.workspace_id = $1 AND l.status = 'active' AND i.paid_at IS NULL AND i.due_date BETWEEN $2::date AND $3::date) AS due_7,
      (SELECT count(*) FROM loan_installments i JOIN loans l ON l.id = i.loan_id
        WHERE l.workspace_id = $1 AND l.status = 'active' AND i.paid_at IS NULL AND i.due_date < $2::date) AS overdue_count,
      (SELECT COALESCE(sum(i.amount), 0) FROM loan_installments i JOIN loans l ON l.id = i.loan_id
        WHERE l.workspace_id = $1 AND l.status = 'active' AND i.paid_at IS NULL AND i.due_date < $2::date) AS overdue_amount,
      (SELECT count(*) FROM loan_messages WHERE workspace_id = $1 AND status IN ('sent','simulated')
        AND created_at > now() - interval '30 days') AS sent_30`, [wsId, t, addDays(t, 6)]),
    many(`SELECT i.id, i.due_date, i.amount, l.id AS loan_id, l.reference, c.id AS customer_id, c.name, c.phone, c.opted_out_at
      FROM loan_installments i JOIN loans l ON l.id = i.loan_id JOIN loan_customers c ON c.id = l.customer_id
      WHERE l.workspace_id = $1 AND l.status = 'active' AND i.paid_at IS NULL AND i.due_date <= $2::date
      ORDER BY i.due_date, c.name LIMIT 100`, [wsId, addDays(t, 6)]),
    rulesFor(wsId),
  ]);
  res.json({
    today: t, currency: req.ws.currency, counts,
    upcoming: upcoming.map((u) => ({ ...u, days: daysBetween(t, u.due_date) })),
    rules: { enabled: rules.enabled, channel: rules.channel }, channels: channelStatus(),
  });
}));

// ---------- groups ----------

loans.get('/groups', ah(async (req, res) => {
  res.json(await many(`SELECT g.*, (SELECT count(*) FROM loan_customers c WHERE c.group_id = g.id) AS members
    FROM loan_groups g WHERE g.workspace_id = $1 ORDER BY lower(g.name)`, [req.ws.id]));
}));

loans.post('/groups', requireRole('editor'), ah(async (req, res) => {
  const name = str(req.body.name, 80) || fail(400, 'Group name is required');
  try {
    res.status(201).json(await one('INSERT INTO loan_groups (workspace_id, name) VALUES ($1, $2) RETURNING *', [req.ws.id, name]));
  } catch (err) {
    if (err.code === '23505') fail(409, 'A group with that name already exists');
    throw err;
  }
}));

loans.patch('/groups/:id', requireRole('editor'), ah(async (req, res) => {
  const g = await groupFor(req, req.params.id);
  const name = str(req.body.name, 80) || fail(400, 'Group name is required');
  res.json(await one('UPDATE loan_groups SET name = $2 WHERE id = $1 RETURNING *', [g.id, name]));
}));

loans.delete('/groups/:id', requireRole('editor'), ah(async (req, res) => {
  const g = await groupFor(req, req.params.id);
  await pool.query('DELETE FROM loan_groups WHERE id = $1', [g.id]);
  res.json({ ok: true });
}));

// ---------- customers ----------

function customerInput(body, partial = false) {
  const out = {};
  if (!partial || body.name !== undefined) out.name = str(body.name, 120) || fail(400, 'Customer name is required');
  if (!partial || body.phone !== undefined) {
    out.phone = str(body.phone, 24);
    if (out.phone && !PHONE_RE.test(out.phone)) fail(400, 'Phone number looks wrong (digits, spaces, + only)');
  }
  if (!partial || body.email !== undefined) {
    out.email = str(body.email, 160).toLowerCase();
    if (out.email && !EMAIL_RE.test(out.email)) fail(400, 'Email address looks wrong');
  }
  for (const ch of CHANNELS) if (!partial || body[`consent_${ch}`] !== undefined) out[`consent_${ch}`] = bool(body[`consent_${ch}`]);
  if (!partial || body.notes !== undefined) out.notes = str(body.notes, 2000);
  return out;
}

const CUSTOMER_LIST = `
  SELECT c.*, g.name AS group_name,
    (SELECT count(*) FROM loans l WHERE l.customer_id = c.id AND l.status = 'active') AS active_loans,
    (SELECT min(i.due_date) FROM loan_installments i JOIN loans l ON l.id = i.loan_id
      WHERE l.customer_id = c.id AND l.status = 'active' AND i.paid_at IS NULL) AS next_due,
    (SELECT COALESCE(sum(i.amount), 0) FROM loan_installments i JOIN loans l ON l.id = i.loan_id
      WHERE l.customer_id = c.id AND l.status = 'active' AND i.paid_at IS NULL AND i.due_date < $2::date) AS overdue_amount
  FROM loan_customers c LEFT JOIN loan_groups g ON g.id = c.group_id`;

loans.get('/customers', ah(async (req, res) => {
  const params = [req.ws.id, req.today];
  let where = 'c.workspace_id = $1';
  if (req.query.group_id) { params.push(intId(req.query.group_id)); where += ` AND c.group_id = $${params.length}`; }
  if (req.query.q) { params.push(`%${String(req.query.q).slice(0, 80)}%`); where += ` AND (c.name ILIKE $${params.length} OR c.phone ILIKE $${params.length} OR c.email ILIKE $${params.length})`; }
  res.json(await many(`${CUSTOMER_LIST} WHERE ${where} ORDER BY lower(c.name) LIMIT 1000`, params));
}));

loans.get('/customers/:id', ah(async (req, res) => {
  const c = await customerFor(req, intId(req.params.id));
  const [row, loanRows, installments, messages] = await Promise.all([
    one(`${CUSTOMER_LIST} WHERE c.id = $1 AND c.workspace_id = $3`, [c.id, req.today, req.ws.id]),
    many('SELECT * FROM loans WHERE customer_id = $1 ORDER BY created_at DESC', [c.id]),
    many(`SELECT i.* FROM loan_installments i JOIN loans l ON l.id = i.loan_id WHERE l.customer_id = $1 ORDER BY i.loan_id, i.seq`, [c.id]),
    many('SELECT * FROM loan_messages WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 50', [c.id]),
  ]);
  res.json({ ...row, loans: loanRows.map((l) => ({ ...l, installments: installments.filter((i) => i.loan_id === l.id) })), messages });
}));

loans.post('/customers', requireRole('editor'), ah(async (req, res) => {
  const data = customerInput(req.body);
  const g = await groupFor(req, req.body.group_id);
  const c = await one(`
    INSERT INTO loan_customers (workspace_id, group_id, name, phone, email, consent_sms, consent_whatsapp, consent_email, notes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
  [req.ws.id, g?.id ?? null, data.name, data.phone, data.email, data.consent_sms, data.consent_whatsapp, data.consent_email, data.notes]);
  await logActivity(req.ws.id, req.user.id, 'loans.customer_added', c.name);
  res.status(201).json(c);
}));

loans.patch('/customers/:id', requireRole('editor'), ah(async (req, res) => {
  const c = await customerFor(req, intId(req.params.id));
  const data = customerInput(req.body, true);
  if (req.body.group_id !== undefined) data.group_id = (await groupFor(req, req.body.group_id))?.id ?? null;
  const keys = Object.keys(data);
  if (!keys.length) return res.json(c);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  res.json(await one(`UPDATE loan_customers SET ${sets} WHERE id = $1 RETURNING *`, [c.id, ...keys.map((k) => data[k])]));
}));

/** Record an opt-out (or undo one). Opted-out customers receive nothing on any channel. */
loans.post('/customers/:id/opt-out', requireRole('editor'), ah(async (req, res) => {
  const c = await customerFor(req, intId(req.params.id));
  const out = req.body.opted_out !== false;
  const row = await one('UPDATE loan_customers SET opted_out_at = $2 WHERE id = $1 RETURNING *', [c.id, out ? new Date() : null]);
  await logActivity(req.ws.id, req.user.id, out ? 'loans.opted_out' : 'loans.opted_in', c.name);
  res.json(row);
}));

loans.delete('/customers/:id', requireRole('editor'), ah(async (req, res) => {
  const c = await customerFor(req, intId(req.params.id));
  await pool.query('DELETE FROM loan_customers WHERE id = $1', [c.id]);
  await logActivity(req.ws.id, req.user.id, 'loans.customer_deleted', c.name);
  res.json({ ok: true });
}));

// ---------- loans & instalments ----------

loans.post('/customers/:id/loans', requireRole('editor'), ah(async (req, res) => {
  const c = await customerFor(req, intId(req.params.id));
  const principal = Number(req.body.principal);
  const count = Number(req.body.installments);
  const frequency = ['weekly', 'monthly'].includes(req.body.frequency) ? req.body.frequency : fail(400, 'Frequency must be weekly or monthly');
  const firstDue = DATE_RE.test(req.body.first_due) ? req.body.first_due : fail(400, 'First due date is required (YYYY-MM-DD)');
  if (!(principal > 0) || principal > 1e11) fail(400, 'Loan amount must be more than zero');
  if (!Number.isInteger(count) || count < 1 || count > 360) fail(400, 'Number of instalments must be 1–360');
  const each = req.body.installment_amount ? Number(req.body.installment_amount) : Math.round((principal / count) * 100) / 100;
  if (!(each > 0)) fail(400, 'Instalment amount must be more than zero');
  const loan = await tx(async (cl) => {
    const l = (await cl.query(`
      INSERT INTO loans (workspace_id, customer_id, reference, principal, installment_amount, installments, frequency, first_due)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.ws.id, c.id, str(req.body.reference, 60), principal, each, count, frequency, firstDue])).rows[0];
    const dates = schedule(firstDue, count, frequency);
    for (const [i, due] of dates.entries()) {
      await cl.query('INSERT INTO loan_installments (loan_id, seq, due_date, amount) VALUES ($1, $2, $3, $4)', [l.id, i + 1, due, each]);
    }
    return l;
  });
  await logActivity(req.ws.id, req.user.id, 'loans.loan_added', `${c.name} · ${loan.reference || `#${loan.id}`}`);
  res.status(201).json({ ...loan, installments: await many('SELECT * FROM loan_installments WHERE loan_id = $1 ORDER BY seq', [loan.id]) });
}));

async function loanFor(req, id) {
  return (await one('SELECT * FROM loans WHERE id = $1 AND workspace_id = $2', [id, req.ws.id])) || fail(404, 'Loan not found');
}

loans.patch('/loans/:id', requireRole('editor'), ah(async (req, res) => {
  const l = await loanFor(req, intId(req.params.id));
  const status = ['active', 'closed'].includes(req.body.status) ? req.body.status : fail(400, 'Status must be active or closed');
  res.json(await one('UPDATE loans SET status = $2 WHERE id = $1 RETURNING *', [l.id, status]));
}));

loans.delete('/loans/:id', requireRole('editor'), ah(async (req, res) => {
  const l = await loanFor(req, intId(req.params.id));
  await pool.query('DELETE FROM loans WHERE id = $1', [l.id]);
  res.json({ ok: true });
}));

loans.post('/installments/:id/pay', requireRole('editor'), ah(async (req, res) => {
  const inst = await one(`SELECT i.* FROM loan_installments i JOIN loans l ON l.id = i.loan_id WHERE i.id = $1 AND l.workspace_id = $2`,
    [intId(req.params.id), req.ws.id]) || fail(404, 'Instalment not found');
  const paid = req.body.paid !== false;
  const row = await one('UPDATE loan_installments SET paid_at = $2 WHERE id = $1 RETURNING *', [inst.id, paid ? new Date() : null]);
  // Close the loan automatically once every instalment is paid.
  const open = await one('SELECT count(*) FROM loan_installments WHERE loan_id = $1 AND paid_at IS NULL', [inst.loan_id]);
  await pool.query(`UPDATE loans SET status = $2 WHERE id = $1`, [inst.loan_id, open.count === 0 ? 'closed' : 'active']);
  await logActivity(req.ws.id, req.user.id, paid ? 'loans.paid' : 'loans.unpaid', `Instalment #${inst.id}`);
  res.json(row);
}));

// ---------- reminder rules ----------

loans.get('/rules', ah(async (req, res) => res.json({ ...(await rulesFor(req.ws.id)), channels: channelStatus() })));

loans.put('/rules', requireRole('admin'), ah(async (req, res) => {
  await rulesFor(req.ws.id);
  const b = req.body;
  const days = Array.isArray(b.days_before) ? [...new Set(b.days_before.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 30))].sort((x, y) => y - x).slice(0, 5) : null;
  const overdue = b.overdue_every === undefined ? null : Number(b.overdue_every);
  if (overdue !== null && !(Number.isInteger(overdue) && overdue >= 0 && overdue <= 30)) fail(400, 'Overdue repeat must be 0–30 days');
  if (b.channel !== undefined && !CHANNELS.includes(b.channel)) fail(400, 'Unknown channel');
  const tpl = (k) => (typeof b[k] === 'string' ? (str(b[k], 600) || fail(400, 'Message templates cannot be empty')) : null);
  const row = await one(`
    UPDATE reminder_rules SET
      enabled = COALESCE($2, enabled), days_before = COALESCE($3, days_before), on_due_day = COALESCE($4, on_due_day),
      overdue_every = COALESCE($5, overdue_every), channel = COALESCE($6, channel),
      template_before = COALESCE($7, template_before), template_due = COALESCE($8, template_due),
      template_overdue = COALESCE($9, template_overdue), updated_at = now()
    WHERE workspace_id = $1 RETURNING *`,
  [req.ws.id, typeof b.enabled === 'boolean' ? b.enabled : null, days, typeof b.on_due_day === 'boolean' ? b.on_due_day : null,
    overdue, b.channel ?? null, tpl('template_before'), tpl('template_due'), tpl('template_overdue')]);
  await logActivity(req.ws.id, req.user.id, 'loans.rules_updated', row.enabled ? 'Reminders on' : 'Reminders off');
  res.json({ ...row, channels: channelStatus() });
}));

loans.post('/rules/run', requireRole('admin'), ah(async (req, res) => {
  res.json({ created: await runReminders(new Date(), req.ws.id) });
}));

// ---------- manual messages ----------

loans.post('/send', requireRole('editor'), ah(async (req, res) => {
  const channel = CHANNELS.includes(req.body.channel) ? req.body.channel : fail(400, 'Pick SMS, WhatsApp or email');
  const body = str(req.body.body, 1000) || fail(400, 'Write a message');
  let recipients;
  if (req.body.group_id) {
    const g = await groupFor(req, req.body.group_id);
    recipients = await many(`${CUSTOMER_LIST} WHERE c.workspace_id = $1 AND c.group_id = $3`, [req.ws.id, req.today, g.id]);
  } else {
    const ids = Array.isArray(req.body.customer_ids) ? req.body.customer_ids.map(Number).filter(Number.isInteger) : [];
    if (!ids.length) fail(400, 'Choose at least one customer or a group');
    recipients = await many(`${CUSTOMER_LIST} WHERE c.workspace_id = $1 AND c.id = ANY($3::int[])`, [req.ws.id, req.today, ids]);
  }
  if (!recipients.length) fail(400, 'No customers to send to');
  if (recipients.length > 500) fail(400, 'Send to at most 500 customers at once');
  const results = { simulated: 0, sent: 0, skipped: 0, failed: 0 };
  for (const c of recipients) {
    const text = render(body, {
      name: c.name.split(/\s+/)[0], company: req.ws.name,
      due_date: c.next_due ? prettyDate(c.next_due) : '', amount: c.overdue_amount ? money(c.overdue_amount, req.ws.currency) : '',
    });
    const row = await recordMessage(pool, { workspaceId: req.ws.id, customer: c, sentBy: req.user.id, kind: 'manual', channel, body: text });
    results[row.status] += 1;
  }
  await logActivity(req.ws.id, req.user.id, 'loans.message_sent', `${recipients.length} by ${channel}`);
  res.json({ recipients: recipients.length, ...results });
}));

loans.get('/messages', ah(async (req, res) => {
  const params = [req.ws.id];
  let where = 'm.workspace_id = $1';
  if (req.query.status) { params.push(String(req.query.status)); where += ` AND m.status = $${params.length}`; }
  if (req.query.customer_id) { params.push(intId(req.query.customer_id)); where += ` AND m.customer_id = $${params.length}`; }
  res.json(await many(`
    SELECT m.*, c.name AS customer_name, u.display_name AS sent_by_name
    FROM loan_messages m LEFT JOIN loan_customers c ON c.id = m.customer_id LEFT JOIN users u ON u.id = m.sent_by
    WHERE ${where} ORDER BY m.created_at DESC LIMIT 300`, params));
}));
