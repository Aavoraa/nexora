// Demo data for development and the Product Demo (DATABASE.md §12).
// Re-running replaces the demo workspace; other workspaces are untouched.
import { migrate, pool, tx } from '../server/db.js';
import { hashPassword } from '../server/auth.js';
import * as storage from '../server/storage.js';
import { todayIn, addDays, schedule, runReminders } from '../server/loans.js';

const PASSWORD = process.env.SEED_PASSWORD;
if (!PASSWORD || PASSWORD.length < 8) {
  console.error('Set SEED_PASSWORD (8+ characters) in .env — see .env.example.');
  process.exit(1);
}

const USERS = [
  { username: 'demo_owner', display_name: 'Priya (Owner)', role: 'owner', can_approve: true },
  { username: 'demo_editor', display_name: 'Arjun (Editor)', role: 'editor', can_approve: false },
  { username: 'demo_viewer', display_name: 'Meera (Reviewer)', role: 'viewer', can_approve: true },
];

const BRANDS = [
  {
    name: 'Brewhouse Café', color: '#c2410c',
    voice: 'Warm and neighbourly. Short sentences, one emoji at most, no hard selling.',
    // Instagram is last: text-only demo posts go to Facebook and X, because Instagram needs media.
    channels: [['facebook', 'brewhousecafe'], ['x', 'brewhouse'], ['instagram', 'brewhousecafe']],
  },
  {
    name: 'Nimbus Analytics', color: '#2563eb',
    voice: 'Clear, confident and practical. Lead with the customer outcome; avoid jargon.',
    channels: [['linkedin', 'nimbus-analytics'], ['x', 'nimbusdata']],
  },
];

const POSTS = {
  'Brewhouse Café': [
    ['published', -9, 'Rainy Monday? Our cinnamon oat latte is back. ☕', [0, 1]],
    ['published', -6, 'Meet Ravi, our new head baker. Ask him about the sourdough.', [0, 1]],
    ['published', -3, 'Saturday open mic is on — sign-ups at the counter from 5pm.', [1, 2]],
    ['failed', -1, 'Weekend brunch menu drops tomorrow.', [2]],
    ['scheduled', 1, 'New pumpkin spice cold brew lands this Friday. Who is in?', [0, 1]],
    ['scheduled', 3, 'Bring your own cup this week and get ₹20 off any drink.', [0, 1]],
    ['scheduled', 6, 'Behind the scenes: how we roast our house blend.', [0]],
    ['pending', 2, 'Hiring! Weekend barista, friendly people only. DM us.', [0, 1]],
    ['pending', 5, 'Our autumn playlist is live — link in bio.', [0]],
    ['draft', null, 'Idea: customer of the month feature?', [0, 1]],
    ['draft', null, 'Diwali hours post — confirm timings with the team.', [1]],
  ],
  'Nimbus Analytics': [
    ['published', -8, 'How a 40-store retailer cut stock-outs by 18% with weekly demand forecasts.', [0]],
    ['published', -4, 'We are hiring a senior data engineer in Bengaluru. Remote-friendly.', [0, 1]],
    ['scheduled', 2, 'Webinar Thursday: turning messy sales data into a clean weekly forecast.', [0, 1]],
    ['scheduled', 7, 'Three questions to ask before you buy any BI tool.', [0]],
    ['pending', 4, 'Case study: from 12 spreadsheets to one live dashboard in two weeks.', [0]],
    ['draft', null, 'Q4 product update — waiting on release notes.', [0, 1]],
  ],
};

const day = (offset, hour) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(hour, 0, 0, 0);
  return d;
};

// [name, phone, email, group, consented channels, opted out, [loan ref, amount, instalments, frequency, first due (days from today), instalments paid]]
const LOAN_CUSTOMERS = [
  ['Asha Rao', '+91 98450 11201', 'asha.rao@example.com', 'Riverside branch', ['sms', 'email'], false, ['L-2026-031', 60000, 12, 'monthly', -62, 1]],
  ['Vikram Shetty', '+91 98450 11202', '', 'Riverside branch', ['sms', 'whatsapp'], false, ['L-2026-044', 24000, 8, 'weekly', -20, 2]],
  ['Meena Pillai', '+91 98450 11203', 'meena.p@example.com', 'Women’s savings circle', ['whatsapp'], false, ['L-2026-052', 15000, 10, 'weekly', 1, 0]],
  ['Farah Khan', '+91 98450 11204', '', 'Women’s savings circle', ['sms'], false, ['L-2026-053', 15000, 10, 'weekly', 3, 0]],
  ['Joseph Mathew', '+91 98450 11205', 'joseph.m@example.com', 'Riverside branch', ['email'], false, ['L-2026-019', 120000, 24, 'monthly', -150, 5]],
  ['Lakshmi Iyer', '+91 98450 11206', '', 'Women’s savings circle', ['sms'], true, ['L-2026-047', 18000, 6, 'monthly', -40, 1]],
];
/** Reusable library posts (D16): [title, category, tags, body, pre-approved, times used]. */
const LIBRARY = [
  ['First-time buyer checklist', 'Educational', ['firsttimebuyer', 'tips'],
    'Thinking about buying your first home? Start here:\n1. Check your credit report\n2. Work out a comfortable monthly payment\n3. Get pre-approved before you house-hunt\nQuestions? Send me a message.', true, 6],
  ['What pre-approval means', 'Educational', ['preapproval'],
    'Pre-approval tells sellers you are a serious buyer. It takes about a day with the right documents, and it shows you exactly what you can afford.', true, 3],
  ['Weekly rate update', 'Market update', ['rates', 'weekly'],
    'Rates moved this week. Here is what it means if you are buying, and if you are thinking about refinancing. Book a 10-minute call to see your numbers.', false, 2],
  ['Client keys celebration', 'Testimonial', ['clientwin'],
    'Another family has the keys to their first home! Thank you for trusting us with such a big step. 🏡', true, 4],
  ['Festive season offer', 'Seasonal', ['festive', 'offer'],
    'Planning a move this festive season? Talk to us this month about a quick pre-approval so you are ready when you find the right place.', false, 0],
  ['Free homebuyer Q&A', 'Event', ['event', 'qa'],
    'Join our free homebuyer Q&A next Thursday at 7 pm. Bring your questions about deposits, loan types and timelines. Reply to save a seat.', false, 1],
];

let wsId;

await migrate();

await tx(async (c) => {
  // Remove a previous demo workspace (cascades to everything in it), including its stored files.
  const old = await c.query(`SELECT m.storage_key FROM media m JOIN users u ON u.workspace_id = m.workspace_id
    WHERE lower(u.username) = 'demo_owner'`);
  for (const { storage_key: key } of old.rows) await storage.remove(key);
  await c.query(`DELETE FROM workspaces WHERE id IN
    (SELECT workspace_id FROM users WHERE lower(username) = 'demo_owner')`);
  const taken = await c.query(`SELECT username FROM users WHERE lower(username) = ANY($1)`,
    [USERS.map((u) => u.username)]);
  if (taken.rows.length) throw new Error(`Usernames already used elsewhere: ${taken.rows.map((r) => r.username).join(', ')}`);

  const ws = (await c.query(
    `INSERT INTO workspaces (name, require_approval, timezone, loans_enabled, currency)
     VALUES ('Demo Agency', TRUE, 'Asia/Kolkata', TRUE, 'INR') RETURNING id`)).rows[0];
  wsId = ws.id;
  const hash = hashPassword(PASSWORD);
  const ids = {};
  for (const u of USERS) {
    ids[u.role] = (await c.query(
      `INSERT INTO users (workspace_id, username, password_hash, display_name, role, can_approve)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [ws.id, u.username, hash, u.display_name, u.role, u.can_approve])).rows[0].id;
  }

  for (const b of BRANDS) {
    const brand = (await c.query(
      'INSERT INTO brands (workspace_id, name, color, voice) VALUES ($1, $2, $3, $4) RETURNING id',
      [ws.id, b.name, b.color, b.voice])).rows[0];
    const channelIds = [];
    for (const [platform, handle] of b.channels) {
      channelIds.push((await c.query(
        'INSERT INTO channels (brand_id, platform, handle) VALUES ($1, $2, $3) RETURNING id',
        [brand.id, platform, handle])).rows[0].id);
    }
    for (let wd = 1; wd <= 5; wd++) {
      await c.query(`INSERT INTO queue_slots (brand_id, weekday, time) VALUES ($1, $2, '09:00'), ($1, $2, '15:00')`,
        [brand.id, wd]);
    }
    for (const [status, offset, content, chIdx] of POSTS[b.name]) {
      const when = offset === null ? null : day(offset, offset % 2 ? 15 : 9);
      await c.query(`
        INSERT INTO posts (brand_id, author_id, content, channel_ids, status, scheduled_at, published_at,
                           approved_by, review_note)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [brand.id, status === 'draft' ? ids.editor : (offset % 3 ? ids.editor : ids.owner), content,
        chIdx.map((i) => channelIds[i]), status, when, status === 'published' ? when : null,
        ['scheduled', 'published'].includes(status) ? ids.owner : null,
        status === 'failed' ? 'Instagram rejected the post: an image is required.' : '']);
    }
  }
  // Loan reminders: groups, customers and loans in every state (overdue, due soon, on track, opted out).
  const groups = {};
  for (const g of ['Riverside branch', 'Women’s savings circle']) {
    groups[g] = (await c.query('INSERT INTO loan_groups (workspace_id, name) VALUES ($1, $2) RETURNING id', [ws.id, g])).rows[0].id;
  }
  const today = todayIn('Asia/Kolkata');
  for (const [name, phone, email, group, consent, optedOut, loan] of LOAN_CUSTOMERS) {
    const cust = (await c.query(`
      INSERT INTO loan_customers (workspace_id, group_id, name, phone, email, consent_sms, consent_whatsapp, consent_email, opted_out_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [ws.id, groups[group], name, phone, email, consent.includes('sms'), consent.includes('whatsapp'), consent.includes('email'),
      optedOut ? new Date() : null])).rows[0];
    const [ref, principal, count, frequency, firstOffset, paidCount] = loan;
    const each = Math.round((principal / count) * 100) / 100;
    const first = addDays(today, firstOffset);
    const l = (await c.query(`
      INSERT INTO loans (workspace_id, customer_id, reference, principal, installment_amount, installments, frequency, first_due)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [ws.id, cust.id, ref, principal, each, count, frequency, first])).rows[0];
    for (const [i, due] of schedule(first, count, frequency).entries()) {
      await c.query('INSERT INTO loan_installments (loan_id, seq, due_date, amount, paid_at) VALUES ($1,$2,$3,$4,$5)',
        [l.id, i + 1, due, each, i < paidCount ? new Date() : null]);
    }
  }
  await c.query(`INSERT INTO reminder_rules (workspace_id, enabled, days_before, on_due_day, overdue_every, channel)
    VALUES ($1, TRUE, '{3,1}', TRUE, 3, 'sms')`, [ws.id]);

  for (const [title, category, tags, body, approved, uses] of LIBRARY) {
    await c.query(`INSERT INTO library_items (workspace_id, title, body, category, tags, approved, approved_by, use_count, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [ws.id, title, body, category, tags, approved, approved ? ids.owner : null, uses, ids.editor]);
  }

  await c.query(`INSERT INTO activity (workspace_id, user_id, action, detail) VALUES ($1, $2, 'workspace.created', 'Demo Agency (seeded)')`,
    [ws.id, ids.owner]);
});

// Run the reminder engine once so the message log has examples.
await runReminders(new Date(), wsId);

console.log('Demo workspace "Demo Agency" ready: users demo_owner, demo_editor, demo_viewer (password = SEED_PASSWORD).');
await pool.end();
