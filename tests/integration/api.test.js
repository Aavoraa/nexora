import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipReason, setupApp, client } from '../helpers.js';
import { makeVideo, makePng } from '../fixtures.js';

const skip = skipReason();

describe('API', { skip }, () => {
  let ctx;
  let owner, editor, viewer, outsider, anon;
  let brandId, channelId;

  before(async () => {
    ctx = await setupApp();
    owner = client(ctx.base);
    editor = client(ctx.base);
    viewer = client(ctx.base);
    outsider = client(ctx.base);
    anon = client(ctx.base);

    let r = await owner.post('/auth/register', { workspace: 'Acme', username: 'owner', password: 'password123', timezone: 'Asia/Kolkata' });
    assert.equal(r.status, 201);
    r = await outsider.post('/auth/register', { workspace: 'Other', username: 'outsider', password: 'password123' });
    assert.equal(r.status, 201);

    brandId = (await owner.get('/brands')).data[0].id;
    channelId = (await owner.post(`/brands/${brandId}/channels`, { platform: 'x', handle: '@acme' })).data.id;
    assert.equal((await owner.post('/team', { username: 'editor', password: 'password123', role: 'editor' })).status, 201);
    assert.equal((await owner.post('/team', { username: 'viewer', password: 'password123', role: 'viewer' })).status, 201);
    assert.equal((await editor.post('/auth/login', { username: 'editor', password: 'password123' })).status, 200);
    assert.equal((await viewer.post('/auth/login', { username: 'VIEWER', password: 'password123' })).status, 200);
  });

  after(async () => {
    ctx?.server.close();
    await ctx?.db.pool.end();
  });

  const newPost = (who, content = 'Hello', channels = [channelId]) =>
    who.post('/posts', { brand_id: brandId, content, channel_ids: channels });

  describe('auth', () => {
    test('me reflects the session', async () => {
      assert.equal((await anon.get('/me')).data.user, null);
      const me = (await owner.get('/me')).data;
      assert.equal(me.user.role, 'owner');
      assert.equal(me.workspace.timezone, 'Asia/Kolkata');
    });

    test('register validates input and uniqueness', async () => {
      assert.equal((await anon.post('/auth/register', { workspace: 'X', username: 'ab', password: 'password123' })).status, 400);
      assert.equal((await anon.post('/auth/register', { workspace: 'X', username: 'valid_name', password: 'short' })).status, 400);
      assert.equal((await anon.post('/auth/register', { workspace: 'X', username: 'OWNER', password: 'password123' })).status, 409);
    });

    test('wrong password is rejected without detail', async () => {
      const r = await anon.post('/auth/login', { username: 'owner', password: 'nope' });
      assert.equal(r.status, 401);
      assert.equal(r.data.error, 'Wrong username or password');
    });

    test('protected routes need a session', async () => {
      assert.equal((await anon.get('/posts')).status, 401);
    });

    test('mutations must be JSON (CSRF guard)', async () => {
      const res = await fetch(`${ctx.base}/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'username=owner&password=x',
      });
      assert.equal(res.status, 415);
    });

    test('sign-in is rate limited per username', async () => {
      const c = client(ctx.base);
      let last;
      for (let i = 0; i < 11; i++) last = await c.post('/auth/login', { username: 'ratelimited', password: 'x' });
      assert.equal(last.status, 429);
      assert.ok(Number(last.headers.get('retry-after')) > 0);
    });

    test('"keep me logged in" decides how long the session lasts', async () => {
      const login = (remember) => fetch(`${ctx.base}/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'viewer', password: 'password123', remember }),
      });
      const hoursLeft = async (res) => {
        const token = res.headers.get('set-cookie').split(';')[0].split('=')[1];
        const { rows } = await ctx.db.pool.query('SELECT expires_at FROM sessions WHERE token = $1', [token]);
        return (rows[0].expires_at - Date.now()) / 3600_000;
      };
      const kept = await login(true);
      assert.match(kept.headers.get('set-cookie'), /Expires=/i);
      assert.ok(await hoursLeft(kept) > 24 * 13);

      const brief = await login(false);
      assert.doesNotMatch(brief.headers.get('set-cookie'), /Expires=/i, 'browser-session cookie');
      const h = await hoursLeft(brief);
      assert.ok(h > 11 && h <= 12, `expected ~12h, got ${h}`);
    });

    test('logout ends the session on the server', async () => {
      const c = client(ctx.base);
      await c.post('/auth/login', { username: 'editor', password: 'password123' });
      assert.ok((await c.get('/me')).data.user);
      await c.post('/auth/logout');
      assert.equal((await c.get('/me')).data.user, null);
    });
  });

  describe('roles', () => {
    test('viewer can read but not write', async () => {
      assert.equal((await viewer.get('/posts')).status, 200);
      assert.equal((await newPost(viewer)).status, 403);
      assert.equal((await viewer.put(`/brands/${brandId}/slots`, { slots: [] })).status, 403);
    });

    test('editor cannot manage team, brands or settings', async () => {
      assert.equal((await editor.post('/team', { username: 'x_user', password: 'password123' })).status, 403);
      assert.equal((await editor.post('/brands', { name: 'B' })).status, 403);
      assert.equal((await editor.patch('/workspace', { require_approval: true })).status, 403);
    });

    test('the owner cannot be changed', async () => {
      const team = (await owner.get('/team')).data;
      const ownerRow = team.find((m) => m.role === 'owner');
      assert.equal((await owner.patch(`/team/${ownerRow.id}`, { role: 'viewer' })).status, 403);
    });
  });

  describe('tenant isolation', () => {
    test('another workspace cannot see or change our data', async () => {
      const post = (await newPost(owner, 'secret')).data;
      assert.equal((await outsider.get(`/posts/${post.id}`)).status, 404);
      assert.equal((await outsider.patch(`/posts/${post.id}`, { content: 'pwned' })).status, 404);
      assert.equal((await outsider.patch(`/brands/${brandId}`, { name: 'pwned' })).status, 404);
      assert.equal((await outsider.post('/posts', { brand_id: brandId, content: 'x' })).status, 404);
      assert.deepEqual((await outsider.get('/posts')).data, []);
      const team = (await owner.get('/team')).data;
      // The outsider owns their own workspace, but our members don't exist for them.
      assert.equal((await outsider.del(`/team/${team[1].id}`)).status, 404);
      const outsiderTeam = (await outsider.get('/team')).data;
      assert.equal(outsiderTeam.length, 1);
    });

    test('channels from other brands are dropped from posts', async () => {
      const other = (await outsider.get('/brands')).data[0];
      const ch = (await outsider.post(`/brands/${other.id}/channels`, { platform: 'x', handle: 'o' })).data;
      const p = (await newPost(owner, 'x', [channelId, ch.id])).data;
      assert.deepEqual(p.channel_ids, [channelId]);
    });
  });

  describe('post lifecycle', () => {
    test('scheduling validates content, channels and time', async () => {
      const empty = (await newPost(editor, '')).data;
      const future = new Date(Date.now() + 86400_000).toISOString();
      assert.equal((await editor.post(`/posts/${empty.id}/schedule`, { scheduled_at: future })).status, 400);
      const noCh = (await newPost(editor, 'hi', [])).data;
      assert.equal((await editor.post(`/posts/${noCh.id}/schedule`, { scheduled_at: future })).status, 400);
      const p = (await newPost(editor)).data;
      const past = new Date(Date.now() - 3600_000).toISOString();
      assert.equal((await editor.post(`/posts/${p.id}/schedule`, { scheduled_at: past })).status, 400);
      const ok = await editor.post(`/posts/${p.id}/schedule`, { scheduled_at: future });
      assert.equal(ok.status, 200);
      assert.equal(ok.data.status, 'scheduled');
    });

    test('approval flow: pending → send back → pending → approve', async () => {
      await owner.patch('/workspace', { require_approval: true });
      try {
        const p = (await newPost(editor, 'needs review')).data;
        const q = await editor.post(`/posts/${p.id}/queue`);
        assert.equal(q.data.status, 'pending');
        assert.equal((await editor.post(`/posts/${p.id}/approve`)).status, 403);

        const back = await owner.post(`/posts/${p.id}/reject`, { note: 'Shorter please' });
        assert.equal(back.data.status, 'draft');
        assert.equal(back.data.review_note, 'Shorter please');

        await editor.post(`/posts/${p.id}/queue`);
        const ok = await owner.post(`/posts/${p.id}/approve`);
        assert.equal(ok.data.status, 'scheduled');
        assert.ok(ok.data.approved_by);

        // A non-approver's edit sends it back for review.
        const edited = await editor.patch(`/posts/${p.id}`, { content: 'changed' });
        assert.equal(edited.data.status, 'pending');
        assert.equal(edited.data.approved_by, null);

        // Approvers' own posts skip the queue for approval.
        const own = (await newPost(owner, 'owner post')).data;
        assert.equal((await owner.post(`/posts/${own.id}/queue`)).data.status, 'scheduled');
      } finally {
        await owner.patch('/workspace', { require_approval: false });
      }
    });

    test('queue picks distinct slots in the workspace time zone', async () => {
      const a = (await newPost(editor, 'q1')).data;
      const b = (await newPost(editor, 'q2')).data;
      const ta = (await editor.post(`/posts/${a.id}/queue`)).data.scheduled_at;
      const tb = (await editor.post(`/posts/${b.id}/queue`)).data.scheduled_at;
      assert.notEqual(ta, tb);
      for (const t of [ta, tb]) {
        const local = new Date(t).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
        assert.ok(['09:00', '15:00'].includes(local), `unexpected slot ${local}`);
      }
    });

    test('queue with no slots explains itself', async () => {
      const brand = (await owner.post('/brands', { name: 'Empty' })).data;
      await owner.put(`/brands/${brand.id}/slots`, { slots: [] });
      const ch = (await owner.post(`/brands/${brand.id}/channels`, { platform: 'linkedin', handle: 'e' })).data;
      const p = (await owner.post('/posts', { brand_id: brand.id, content: 'x', channel_ids: [ch.id] })).data;
      const r = await owner.post(`/posts/${p.id}/queue`);
      assert.equal(r.status, 400);
      assert.match(r.data.error, /no queue slots/);
    });

    test('slot updates drop invalid entries', async () => {
      const r = await editor.put(`/brands/${brandId}/slots`, {
        slots: [{ weekday: 1, time: '09:00' }, { weekday: 1, time: '15:00' }, { weekday: 9, time: '10:00' }, { weekday: 2, time: '25:00' }],
      });
      assert.deepEqual(r.data.map((s) => [s.weekday, s.time]), [[1, '09:00'], [1, '15:00']]);
    });

    test('publisher publishes due posts exactly once', async () => {
      const p = (await newPost(editor, 'due now')).data;
      await editor.post(`/posts/${p.id}/schedule`, { scheduled_at: new Date(Date.now() + 60_000).toISOString() });
      await ctx.db.pool.query(`UPDATE posts SET scheduled_at = now() - interval '1 second' WHERE id = $1`, [p.id]);
      await Promise.all([ctx.publisher.runDuePosts(), ctx.publisher.runDuePosts()]);
      const after = (await editor.get(`/posts/${p.id}`)).data;
      assert.equal(after.status, 'published');
      const { rows } = await ctx.db.pool.query(
        `SELECT count(*) FROM activity WHERE action = 'post.published' AND detail = $1`, [`Post #${p.id}`]);
      assert.equal(rows[0].count, 1);
      assert.equal((await editor.patch(`/posts/${p.id}`, { content: 'x' })).status, 400);
    });

    test('a post with no remaining channels fails and can be recovered', async () => {
      const ch = (await owner.post(`/brands/${brandId}/channels`, { platform: 'threads', handle: 'tmp' })).data;
      const p = (await newPost(editor, 'orphan', [ch.id])).data;
      await editor.post(`/posts/${p.id}/schedule`, { scheduled_at: new Date(Date.now() + 60_000).toISOString() });
      await owner.del(`/brands/${brandId}/channels/${ch.id}`);
      await ctx.db.pool.query(`UPDATE posts SET scheduled_at = now() - interval '1 second' WHERE id = $1`, [p.id]);
      await ctx.publisher.runDuePosts();
      const failed = (await editor.get(`/posts/${p.id}`)).data;
      assert.equal(failed.status, 'failed');
      assert.ok(failed.review_note);
      const edited = await editor.patch(`/posts/${p.id}`, { channel_ids: [channelId] });
      assert.equal(edited.data.status, 'draft');
    });
  });

  describe('media', () => {
    const origin = () => ctx.base.replace(/\/api$/, '');

    /** Full browser-style upload: register, PUT the bytes, complete. */
    async function upload(who, buf, { name = 'clip.mp4', mime = 'video/mp4', declared = buf.length } = {}) {
      const created = await who.post('/media', { filename: name, mime, bytes: declared });
      if (created.status !== 201) return created;
      const put = await fetch(origin() + created.data.upload.url, { method: 'PUT', body: buf });
      if (put.status !== 200) return { status: put.status, data: await put.json().catch(() => null) };
      return who.post(`/media/${created.data.media.id}/complete`);
    }

    test('a portrait phone video uploads, is inspected and gets readiness tags', async () => {
      const r = await upload(editor, makeVideo({ width: 1920, height: 1080, rotate90: true, seconds: 20, brand: 'qt  ' }),
        { name: 'reel.mov', mime: 'video/quicktime' });
      assert.equal(r.status, 200);
      assert.equal(r.data.status, 'ready');
      assert.equal(r.data.kind, 'video');
      assert.equal(r.data.mime, 'video/quicktime');
      assert.deepEqual([r.data.width, r.data.height, r.data.duration_ms], [1080, 1920, 20000]);
      assert.equal(r.data.aspect, '9:16');
      assert.equal(r.data.readiness.tiktok.ok, true);
      assert.equal(r.data.storage_key, undefined, 'storage keys never leave the server');

      const list = (await viewer.get('/media')).data;
      assert.ok(list.some((m) => m.id === r.data.id));
      const file = await fetch(origin() + r.data.url);
      assert.equal(file.status, 200);
      assert.equal((await file.arrayBuffer()).byteLength, makeVideo({ rotate90: true, seconds: 20, brand: 'qt  ' }).length);
    });

    test('a non-media file is rejected and removed, whatever it is called', async () => {
      const r = await upload(editor, Buffer.from('%PDF-1.7 definitely not a video'), { name: 'sneaky.mp4' });
      assert.equal(r.status, 422);
      assert.match(r.data.error, /Only MP4 or MOV/);
      const { rows } = await ctx.db.pool.query(`SELECT count(*) FROM media WHERE filename = 'sneaky.mp4'`);
      assert.equal(rows[0].count, 0);
    });

    test('size limits apply before and during upload', async () => {
      const tooBig = await editor.post('/media', { filename: 'big.mp4', mime: 'video/mp4', bytes: 600 * 1024 * 1024 });
      assert.equal(tooBig.status, 400);
      assert.match(tooBig.data.error, /500 MB/);
      assert.equal((await editor.post('/media', { filename: 'x.gif', mime: 'image/gif', bytes: 10 })).status, 400);
      // Body larger than the size the URL was signed for.
      const r = await upload(editor, makePng(), { name: 'p.png', mime: 'image/png', declared: 20 });
      assert.equal(r.status, 413);
    });

    test('signed URLs cannot be tampered with', async () => {
      const r = await upload(editor, makePng(1080, 1080), { name: 'sq.png', mime: 'image/png' });
      const url = new URL(origin() + r.data.url);
      url.searchParams.set('exp', String(Number(url.searchParams.get('exp')) + 3600));
      assert.equal((await fetch(url)).status, 403);
      const other = r.data.url.replace(/ws\/\d+\//, 'ws/999999/');
      assert.equal((await fetch(origin() + other)).status, 403);
    });

    test('viewers can see but not upload or delete media', async () => {
      assert.equal((await viewer.post('/media', { filename: 'a.png', mime: 'image/png', bytes: 100 })).status, 403);
      const m = (await editor.get('/media')).data[0];
      assert.equal((await viewer.del(`/media/${m.id}`)).status, 403);
    });

    test('other workspaces cannot use, complete or delete our media', async () => {
      const m = (await editor.get('/media')).data[0];
      assert.deepEqual((await outsider.get('/media')).data, []);
      assert.equal((await outsider.del(`/media/${m.id}`)).status, 404);
      assert.equal((await outsider.post(`/media/${m.id}/complete`)).status, 404);
      const theirBrand = (await outsider.get('/brands')).data[0];
      const r = await outsider.post('/posts', { brand_id: theirBrand.id, content: 'x', media_ids: [m.id] });
      assert.equal(r.status, 400);
    });

    test('Instagram posts need media; a post holds one video or images', async () => {
      const ig = (await owner.post(`/brands/${brandId}/channels`, { platform: 'instagram', handle: 'acme.ig' })).data;
      const p = (await newPost(editor, 'reel time', [ig.id])).data;
      const when = new Date(Date.now() + 86400_000).toISOString();
      const blocked = await editor.post(`/posts/${p.id}/schedule`, { scheduled_at: when });
      assert.equal(blocked.status, 400);
      assert.match(blocked.data.error, /Instagram posts need an image or video/);

      const media = (await editor.get('/media')).data;
      const video = media.find((m) => m.kind === 'video');
      const image = media.find((m) => m.kind === 'image');
      assert.equal((await editor.patch(`/posts/${p.id}`, { media_ids: [video.id, image.id] })).status, 400);

      const withVideo = await editor.patch(`/posts/${p.id}`, { media_ids: [video.id] });
      assert.equal(withVideo.data.media.length, 1);
      assert.ok(withVideo.data.media[0].url);
      assert.equal((await editor.post(`/posts/${p.id}/schedule`, { scheduled_at: when })).data.status, 'scheduled');

      // In use by a scheduled post: deletion is refused.
      const del = await editor.del(`/media/${video.id}`);
      assert.equal(del.status, 409);
      await editor.post(`/posts/${p.id}/unschedule`);
    });

    test('media on a published post is archived, not deleted', async () => {
      const r = await upload(editor, makeVideo({ seconds: 5 }), { name: 'keep.mp4' });
      const p = (await editor.post('/posts', { brand_id: brandId, content: 'published with video', channel_ids: [channelId], media_ids: [r.data.id] })).data;
      await editor.post(`/posts/${p.id}/schedule`, { scheduled_at: new Date(Date.now() + 60_000).toISOString() });
      await ctx.db.pool.query(`UPDATE posts SET scheduled_at = now() - interval '1 second' WHERE id = $1`, [p.id]);
      await ctx.publisher.runDuePosts();

      const del = await editor.del(`/media/${r.data.id}`);
      assert.equal(del.data.result, 'archived');
      assert.ok(!(await editor.get('/media')).data.some((m) => m.id === r.data.id), 'hidden from the library');
      const after = (await editor.get(`/posts/${p.id}`)).data;
      assert.equal(after.media[0].id, r.data.id, 'published post keeps its media');
    });

    test('unused media is deleted outright', async () => {
      const r = await upload(editor, makePng(), { name: 'gone.png', mime: 'image/png' });
      assert.equal((await editor.del(`/media/${r.data.id}`)).data.result, 'deleted');
      assert.equal((await fetch(origin() + r.data.url)).status, 404);
    });

    test('abandoned uploads are cleaned up', async () => {
      const created = (await editor.post('/media', { filename: 'never.mp4', mime: 'video/mp4', bytes: 100 })).data;
      await ctx.db.pool.query(`UPDATE media SET created_at = now() - interval '25 hours' WHERE id = $1`, [created.media.id]);
      const { cleanupStaleUploads } = await import('../../server/media.js');
      assert.ok(await cleanupStaleUploads() >= 1);
      const { rows } = await ctx.db.pool.query('SELECT count(*) FROM media WHERE id = $1', [created.media.id]);
      assert.equal(rows[0].count, 0);
    });
  });

  describe('loan reminders', () => {
    // Dates in the workspace's time zone, exactly as the server computes "today".
    let inDays;
    before(async () => {
      const { todayIn, addDays } = await import('../../server/loans.js');
      const today = todayIn('Asia/Kolkata');
      inDays = (n) => addDays(today, n);
    });
    let customer;
    let groupId;

    test('is off until an admin switches it on', async () => {
      const off = await editor.get('/loans/overview');
      assert.equal(off.status, 403);
      assert.equal(off.data.code, 'loans_disabled');
      assert.equal((await editor.patch('/workspace', { loans_enabled: true })).status, 403, 'editors cannot switch it on');
      const on = await owner.patch('/workspace', { loans_enabled: true, currency: 'INR' });
      assert.equal(on.data.loans_enabled, true);
      assert.equal((await owner.patch('/workspace', { currency: 'XYZ' })).status, 400);
    });

    test('customers and groups: validation, roles and tenancy', async () => {
      groupId = (await editor.post('/loans/groups', { name: 'Riverside JLG' })).data.id;
      assert.equal((await editor.post('/loans/groups', { name: 'riverside jlg' })).status, 409);
      assert.equal((await editor.post('/loans/customers', { name: '' })).status, 400);
      assert.equal((await editor.post('/loans/customers', { name: 'X', phone: 'call me' })).status, 400);
      assert.equal((await viewer.post('/loans/customers', { name: 'X' })).status, 403);
      customer = (await editor.post('/loans/customers', {
        name: 'Asha Rao', phone: '+91 98765 43210', email: 'asha@example.com', group_id: groupId, consent_sms: true,
      })).data;
      assert.equal(customer.group_id, groupId);
      // Another workspace can't see or touch it (and its own loans are off).
      await outsider.patch('/workspace', { loans_enabled: true });
      assert.equal((await outsider.get(`/loans/customers/${customer.id}`)).status, 404);
      assert.deepEqual((await outsider.get('/loans/customers')).data, []);
      assert.equal((await outsider.post('/loans/customers', { name: 'Y', group_id: groupId })).status, 400);
    });

    test('a loan generates its instalment schedule', async () => {
      const r = await editor.post(`/loans/customers/${customer.id}/loans`, {
        reference: 'L-001', principal: 12000, installments: 4, frequency: 'weekly', first_due: inDays(-7),
      });
      assert.equal(r.status, 201);
      assert.equal(r.data.installments.length, 4);
      assert.equal(r.data.installment_amount, 3000);
      assert.deepEqual(r.data.installments.map((i) => i.due_date), [inDays(-7), inDays(0), inDays(7), inDays(14)]);
      assert.equal((await editor.post(`/loans/customers/${customer.id}/loans`, { principal: 0, installments: 2, frequency: 'monthly', first_due: inDays(1) })).status, 400);
    });

    test('overview counts overdue and due-this-week instalments', async () => {
      const o = (await viewer.get('/loans/overview')).data;
      assert.equal(o.counts.customers, 1);
      assert.equal(o.counts.active_loans, 1);
      assert.equal(o.counts.overdue_count, 1);
      assert.equal(o.counts.overdue_amount, 3000);
      assert.ok(o.counts.due_7 >= 1);
      assert.deepEqual(o.channels, { sms: false, whatsapp: false, email: false });
      assert.ok(o.upcoming.some((u) => u.days === -7));
    });

    test('reminder engine creates each reminder once', async () => {
      assert.equal((await editor.put('/loans/rules', { enabled: true })).status, 403, 'rules are admin-only');
      const rules = await owner.put('/loans/rules', { enabled: true, days_before: [7, 1], on_due_day: true, overdue_every: 7, channel: 'sms' });
      assert.deepEqual(rules.data.days_before, [7, 1]);
      const first = (await owner.post('/loans/rules/run')).data.created;
      // Due today (due), due in 7 days (before:7), 7 days overdue (overdue every 7).
      assert.equal(first, 3);
      assert.equal((await owner.post('/loans/rules/run')).data.created, 0, 'idempotent');
      const log = (await viewer.get('/loans/messages')).data;
      assert.deepEqual(log.map((m) => m.kind).sort(), ['before', 'due', 'overdue']);
      assert.ok(log.every((m) => m.status === 'simulated' && /Reply STOP to opt out\./.test(m.body)));
      assert.match(log.find((m) => m.kind === 'due').body, /Asha/);
    });

    test('paying instalments clears overdue and closes the loan', async () => {
      const detail = (await editor.get(`/loans/customers/${customer.id}`)).data;
      const insts = detail.loans[0].installments;
      for (const i of insts) assert.equal((await editor.post(`/loans/installments/${i.id}/pay`)).status, 200);
      const after = (await editor.get(`/loans/customers/${customer.id}`)).data;
      assert.equal(after.loans[0].status, 'closed');
      assert.equal(after.overdue_amount, 0);
      await editor.post(`/loans/installments/${insts[0].id}/pay`, { paid: false });
      assert.equal((await editor.get(`/loans/customers/${customer.id}`)).data.loans[0].status, 'active', 'unpaying reopens');
    });

    test('manual messages respect consent and opt-out', async () => {
      const noConsent = (await editor.post('/loans/customers', { name: 'Ben Das', phone: '+91 90000 00000', group_id: groupId })).data;
      const r = await editor.post('/loans/send', { group_id: groupId, channel: 'sms', body: 'Hello {name}, branch closed Monday.' });
      assert.deepEqual([r.data.recipients, r.data.simulated, r.data.skipped], [2, 1, 1]);
      await editor.post(`/loans/customers/${customer.id}/opt-out`);
      const r2 = await editor.post('/loans/send', { customer_ids: [customer.id], channel: 'sms', body: 'Hi' });
      assert.equal(r2.data.skipped, 1);
      const skipped = (await editor.get('/loans/messages?status=skipped')).data.map((m) => m.reason);
      assert.ok(skipped.includes('Customer opted out') && skipped.includes('No SMS consent'));
      assert.equal((await editor.post('/loans/send', { customer_ids: [], channel: 'sms', body: 'x' })).status, 400);
      assert.equal((await outsider.post('/loans/send', { customer_ids: [noConsent.id], channel: 'sms', body: 'x' })).data.recipients, undefined);
    });
  });

  describe('setup: integration credentials', () => {
    test('everyone sees the catalogue; nothing is configured or connected yet', async () => {
      const r = (await viewer.get('/integrations')).data;
      assert.equal(r.social.length, 8);
      assert.equal(r.messaging.length, 3);
      assert.equal(r.encryption_ready, true);
      assert.ok(r.social.every((s) => !s.configured && !s.connected && !s.available));
    });

    test('only admins save details, secrets never come back, storage is encrypted', async () => {
      assert.equal((await editor.put('/integrations/social/linkedin', { client_id: 'a', client_secret: 'b' })).status, 403);
      assert.equal((await owner.put('/integrations/social/linkedin', { client_id: '86abcd1234' })).status, 400);
      const saved = await owner.put('/integrations/social/linkedin', { client_id: '86abcd1234', client_secret: 'TOP-SECRET-xyz' });
      assert.equal(saved.status, 200);
      assert.equal(saved.data.configured, true);
      assert.equal(saved.data.hint, '…1234');
      const everything = JSON.stringify((await owner.get('/integrations')).data);
      assert.ok(!everything.includes('TOP-SECRET-xyz') && !everything.includes('86abcd1234'), 'no secret or full id in any response');
      const { rows } = await ctx.db.pool.query(`SELECT data_enc FROM integration_credentials WHERE key = 'linkedin'`);
      assert.ok(rows[0].data_enc.startsWith('v1:') && !rows[0].data_enc.includes('TOP-SECRET-xyz'));

      // Editing with the secret left blank keeps the saved secret.
      assert.equal((await owner.put('/integrations/social/linkedin', { client_id: '86abcd9999', client_secret: '' })).data.hint, '…9999');
      const { decrypt } = await import('../../server/integrations.js');
      const { rows: r2 } = await ctx.db.pool.query(`SELECT data_enc FROM integration_credentials WHERE key = 'linkedin'`);
      assert.equal(decrypt(r2[0].data_enc).client_secret, 'TOP-SECRET-xyz');
    });

    test('messaging providers are validated', async () => {
      assert.equal((await owner.put('/integrations/messaging/sms', { provider: 'Pigeon', api_key: 'k', sender: 'CADNCE' })).status, 400);
      const ok = await owner.put('/integrations/messaging/sms', { provider: 'MSG91', api_key: 'k-123', sender: 'CADNCE' });
      assert.equal(ok.data.hint, 'MSG91 · …DNCE');
      assert.equal((await owner.put('/integrations/social/myspace', {})).status, 404);
    });

    test('connect explains it is not available yet; other workspaces see nothing', async () => {
      const c = await owner.post('/integrations/social/linkedin/connect');
      assert.equal(c.status, 501);
      assert.match(c.data.error, /isn't available yet/);
      const theirs = (await outsider.get('/integrations')).data;
      assert.ok(theirs.social.every((s) => !s.configured));
      assert.equal((await owner.del('/integrations/social/linkedin')).status, 200);
      assert.equal((await owner.get('/integrations')).data.social.find((s) => s.key === 'linkedin').configured, false);
    });
  });

  describe('AI provider per workspace', () => {
    // Fake the provider APIs: record each request and answer from `replies` in order.
    // Calls to the local test server still go to the real fetch.
    const realFetch = globalThis.fetch;
    const calls = [];
    let replies = [];
    before(() => {
      globalThis.fetch = async (url, init = {}) => {
        const u = String(url);
        if (!/googleapis\.com|groq\.com|openrouter\.ai/.test(u)) return realFetch(url, init);
        calls.push({ url: u, method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
        const [status, body] = replies.shift() || [500, {}];
        return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      };
    });
    after(() => { globalThis.fetch = realFetch; });
    const draftsJson = (...d) => JSON.stringify({ drafts: d });
    const geminiText = (text) => [200, { candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] }];
    const chatText = (text) => [200, { choices: [{ finish_reason: 'stop', message: { content: text } }] }];
    const GEMINI_MODELS = [200, { models: [
      { name: 'models/gemini-1.5-pro', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.0-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.0-flash-image', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    ] }];
    const noPlatformKey = !process.env.ANTHROPIC_API_KEY;

    test('lists the four providers; only admins save keys', async () => {
      const s = (await viewer.get('/ai/settings')).data;
      assert.deepEqual(s.providers.map((p) => p.key), ['anthropic', 'gemini', 'groq', 'openrouter']);
      assert.ok(s.providers.every((p) => !p.configured));
      assert.equal((await editor.put('/ai/settings', { provider: 'gemini', api_key: 'AIzaX' })).status, 403);
      const none = await owner.put('/ai/settings', { provider: 'gemini' });
      assert.equal(none.status, 400);
      assert.match(none.data.error, /No API key provided/);
      assert.equal((await owner.put('/ai/settings', { provider: 'bard', api_key: 'x' })).status, 400);
    });

    test('Gemini: the model is detected automatically and the key stays in a header', async () => {
      replies = [GEMINI_MODELS, geminiText('{"ok": true}')];
      const r = await owner.put('/ai/settings', { provider: 'gemini', api_key: 'AIzaTESTKEY-1234' });
      assert.equal(r.status, 200);
      assert.equal(r.data.detected.model, 'gemini-3.0-flash', 'newest general flash model; image and embedding models skipped');
      assert.equal(r.data.selected, 'gemini');
      assert.equal(r.data.providers.find((p) => p.key === 'gemini').model, 'gemini-3.0-flash');
      assert.ok(!JSON.stringify(r.data).includes('AIzaTESTKEY-1234'));
      const [list, ping] = calls.slice(-2);
      assert.match(list.url, /\/v1beta\/models\?pageSize=200$/);
      assert.match(ping.url, /\/models\/gemini-3\.0-flash:generateContent$/);
      assert.ok(calls.every((c) => !c.url.includes('AIza')), 'key never in a URL');
      assert.equal(ping.headers['x-goog-api-key'], 'AIzaTESTKEY-1234');
      const { rows } = await ctx.db.pool.query(`SELECT key_enc FROM ai_providers WHERE provider = 'gemini'`);
      assert.ok(rows[0].key_enc.startsWith('v1:') && !rows[0].key_enc.includes('AIzaTESTKEY'));
      assert.equal((await editor.get('/me')).data.ai_enabled, true);

      replies = [geminiText(draftsJson('Rates eased this week.', 'First home? Let us talk.'))];
      const d = await editor.post('/ai/drafts', { brand_id: brandId, brief: 'rates', platform: 'linkedin', count: 2 });
      assert.deepEqual(d.data.drafts, ['Rates eased this week.', 'First home? Let us talk.']);
      assert.equal(calls.at(-1).body.generationConfig.responseMimeType, 'application/json');
    });

    test('a retired model is replaced automatically while drafting', async () => {
      replies = [
        [404, { error: { message: 'models/gemini-3.0-flash is not found' } }], // drafts call
        GEMINI_MODELS, // re-detect: list
        [404, { error: { message: 'not found' } }], // gemini-3.0-flash still gone
        geminiText('{"ok": true}'), // gemini-1.5-pro answers
        geminiText(draftsJson('Back in business.')), // retried drafts call
      ];
      const d = await editor.post('/ai/drafts', { brand_id: brandId, brief: 'x', platform: 'x', count: 1 });
      assert.equal(d.status, 200);
      assert.deepEqual(d.data.drafts, ['Back in business.']);
      assert.match(calls.at(-1).url, /gemini-1\.5-pro:generateContent$/);
      assert.equal((await owner.get('/ai/settings')).data.providers.find((p) => p.key === 'gemini').model, 'gemini-1.5-pro', 'new model saved');
    });

    test('Groq: falls back to the next model, bearer auth, JSON mode, fenced replies parse', async () => {
      replies = [
        [200, { data: [{ id: 'whisper-large-v3' }, { id: 'gpt-oss-120b' }, { id: 'llama-3.3-70b-versatile' }] }],
        [404, { error: { message: 'model decommissioned' } }],
        chatText('{"ok": true}'),
      ];
      const r = await owner.put('/ai/settings', { provider: 'groq', api_key: 'gsk_TEST_9876' });
      assert.equal(r.data.detected.model, 'gpt-oss-120b', 'llama answered 404, so the next candidate was used');
      const pings = calls.slice(-2);
      assert.deepEqual(pings.map((c) => c.body.model), ['llama-3.3-70b-versatile', 'gpt-oss-120b']);
      assert.equal(pings[1].headers.authorization, 'Bearer gsk_TEST_9876');
      assert.deepEqual(pings[1].body.response_format, { type: 'json_object' });

      replies = [chatText('```json\n' + draftsJson('Quick tip for buyers.') + '\n```')];
      const d = await editor.post('/ai/drafts', { brand_id: brandId, brief: 'tip', platform: 'x', count: 1 });
      assert.deepEqual(d.data.drafts, ['Quick tip for buyers.']);
      assert.equal(calls.at(-1).body.model, 'gpt-oss-120b');
    });

    test('a rejected key stops at once and nothing is saved', async () => {
      replies = [[401, { error: { message: 'Invalid API Key' } }]];
      const bad = await owner.put('/ai/settings', { provider: 'openrouter', api_key: 'sk-or-wrong' });
      assert.equal(bad.status, 400);
      assert.match(bad.data.error, /rejected the API key/);
      assert.equal((await owner.get('/ai/settings')).data.providers.find((p) => p.key === 'openrouter').configured, false);
      // Gemini reports bad keys as 400 "API key not valid".
      replies = [[400, { error: { message: 'API key not valid. Please pass a valid API key.' } }]];
      assert.match((await owner.post('/ai/test', { provider: 'gemini', api_key: 'AIzaWRONG' })).data.error, /rejected the API key/);
    });

    test('OpenRouter prefers free models; Test connection reports the chosen model', async () => {
      replies = [
        [200, { data: [
          { id: 'openai/gpt-x', pricing: { prompt: '0.000002', completion: '0.000008' } },
          { id: 'meta-llama/llama-x:free', pricing: { prompt: '0', completion: '0' } },
        ] }],
        chatText('{"ok": true}'),
      ];
      const t = await owner.post('/ai/test', { provider: 'openrouter', api_key: 'sk-or-test' });
      assert.equal(t.data.ok, true);
      assert.equal(t.data.model, 'meta-llama/llama-x:free');
      assert.equal(calls.at(-1).headers.authorization, 'Bearer sk-or-test');
      assert.equal((await owner.get('/ai/settings')).data.providers.find((p) => p.key === 'openrouter').configured, false, 'test does not save');
      const theirs = (await outsider.get('/ai/settings')).data;
      assert.ok(theirs.providers.every((p) => !p.configured));
    });

    test('removing the selected provider turns workspace AI off', { skip: !noPlatformKey }, async () => {
      await owner.del('/ai/settings/groq');
      await owner.post('/ai/settings/unselect');
      const s = (await owner.get('/ai/settings')).data;
      assert.equal(s.selected, null);
      assert.equal(s.source, null);
      assert.equal((await editor.get('/me')).data.ai_enabled, false);
      await owner.del('/ai/settings/gemini');
    });
  });

  describe('link in bio and tracked links', () => {
    const origin = () => ctx.base.replace(/\/api$/, '');
    const browser = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130' };
    const visit = (path, headers = browser, method = 'GET') => fetch(origin() + path, { method, redirect: 'manual', headers });
    let bioLinks;

    test('saving a page: roles, address rules and safe links only', async () => {
      const page = { brand_id: brandId, slug: 'asha-loans', title: 'Asha <b>Rao</b>', bio: 'Home loans & refinancing',
        accent: '#0f766e', links: [{ label: 'Book a call', url: 'https://example.com/book' }, { label: 'Rates', url: 'https://example.com/rates?x=1' }] };
      assert.equal((await viewer.put('/bio', page)).status, 403);
      assert.equal((await editor.put('/bio', { ...page, slug: 'A b' })).status, 400);
      assert.equal((await editor.put('/bio', { ...page, slug: 'admin' })).status, 400);
      const js = await editor.put('/bio', { ...page, links: [{ label: 'x', url: 'javascript:alert(1)' }] });
      assert.equal(js.status, 400);
      assert.equal((await editor.put('/bio', { ...page, links: [{ label: '', url: 'https://a.b' }] })).status, 400);
      assert.equal((await editor.put('/bio', page)).status, 200);
      const got = (await viewer.get(`/bio?brand_id=${brandId}`)).data;
      assert.equal(got.page.slug, 'asha-loans');
      bioLinks = got.page.links;
      assert.deepEqual(bioLinks.map((l) => l.label), ['Book a call', 'Rates']);
      // Another workspace can't take the same address or read our page.
      const theirBrand = (await outsider.get('/brands')).data[0];
      assert.equal((await outsider.put('/bio', { ...page, brand_id: theirBrand.id })).status, 409);
      assert.equal((await outsider.get(`/bio?brand_id=${brandId}`)).status, 404);
    });

    test('the public page is escaped, script-free and links through the tracker', async () => {
      const res = await visit('/b/ASHA-LOANS');
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('Asha &lt;b&gt;Rao&lt;/b&gt;') && !html.includes('<b>Rao</b>'), 'content escaped');
      assert.ok(!/<script/i.test(html));
      assert.ok(html.includes(`href="/r/${bioLinks[0].id}"`));
      assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
      assert.equal((await visit('/b/no-such-page')).status, 404);
    });

    test('bio redirects count real clicks only, and re-saving keeps click history', async () => {
      const r = await visit(`/r/${bioLinks[1].id}`, { ...browser, referer: 'https://www.instagram.com/asha' });
      assert.equal(r.status, 302);
      assert.equal(r.headers.get('location'), 'https://example.com/rates?x=1');
      await visit(`/r/${bioLinks[1].id}`, { 'user-agent': 'facebookexternalhit/1.1' }); // link preview bot
      await visit(`/r/${bioLinks[1].id}`, browser, 'HEAD');
      const { rows } = await ctx.db.pool.query('SELECT referrer_host FROM link_clicks WHERE bio_link_id = $1', [bioLinks[1].id]);
      assert.deepEqual(rows.map((x) => x.referrer_host), ['www.instagram.com'], 'one click, no bots, no HEAD; no IP stored');
      assert.equal((await visit('/r/999999')).status, 404);

      // Reorder and add a link: unchanged links keep their ids (and clicks).
      await editor.put('/bio', { brand_id: brandId, slug: 'asha-loans', title: 'Asha Rao', bio: '', accent: '#0f766e',
        links: [{ label: 'Rates', url: 'https://example.com/rates?x=1' }, { label: 'Book a call', url: 'https://example.com/book' }, { label: 'New', url: 'https://example.com/new' }] });
      const after = (await editor.get(`/bio?brand_id=${brandId}`)).data;
      assert.equal(after.page.links[0].id, bioLinks[1].id);
      assert.equal(after.page.links[0].clicks, 1);
      assert.equal(after.daily.reduce((n, d) => n + d.clicks, 0), 1);
    });

    test('tracked links add UTM tags, redirect and count clicks', async () => {
      assert.equal((await editor.post('/links', { url: 'ftp://x.y' })).status, 400);
      assert.equal((await editor.post('/links', { url: 'https://x.y', utm_source: 'bad source!' })).status, 400);
      assert.equal((await viewer.post('/links', { url: 'https://x.y' })).status, 403);
      const l = await editor.post('/links', { brand_id: brandId, label: 'Webinar', url: 'https://example.com/webinar?ref=bio',
        utm_source: 'instagram', utm_medium: 'social', utm_campaign: 'nov-webinar' });
      assert.equal(l.status, 201);
      assert.match(l.data.code, /^[A-Za-z0-9]{7}$/);
      assert.equal(l.data.destination, 'https://example.com/webinar?ref=bio&utm_source=instagram&utm_medium=social&utm_campaign=nov-webinar');
      const r = await visit(`/l/${l.data.code}`);
      assert.equal(r.status, 302);
      assert.equal(r.headers.get('location'), l.data.destination);
      await visit(`/l/${l.data.code}`);
      await visit(`/l/${l.data.code}`, { 'user-agent': 'WhatsApp/2.0' });
      const list = (await editor.get(`/links?brand_id=${brandId}`)).data;
      assert.equal(list.find((x) => x.id === l.data.id).clicks, 2);
      assert.equal((await outsider.del(`/links/${l.data.id}`)).status, 404);
      assert.equal((await editor.del(`/links/${l.data.id}`)).status, 200);
      assert.equal((await visit(`/l/${l.data.code}`)).status, 404);
    });
  });

  describe('content library', () => {
    let item;

    test('create: roles, validation, tags and tenant isolation', async () => {
      const body = { title: 'Rate update', body: 'Rates moved this week…', category: 'Market update', tags: ['#Rates', 'rates', 'weekly'] };
      assert.equal((await viewer.post('/library', body)).status, 403);
      assert.equal((await editor.post('/library', { ...body, body: '' })).status, 400);
      assert.equal((await editor.post('/library', { ...body, title: '' })).status, 400);
      const theirBrand = (await outsider.get('/brands')).data[0];
      assert.equal((await editor.post('/library', { ...body, brand_id: theirBrand.id })).status, 404);
      assert.equal((await editor.post('/library', { ...body, media_id: 999999 })).status, 400);
      const r = await editor.post('/library', { ...body, category: 'Nonsense' });
      assert.equal(r.status, 201);
      item = r.data;
      assert.deepEqual(item.tags, ['rates', 'weekly']);
      assert.equal(item.category, 'Other');
      assert.equal(item.approved, false);
      assert.ok((await viewer.get('/library')).data.items.some((x) => x.id === item.id));
      assert.equal((await outsider.get('/library')).data.items.length, 0);
      assert.equal((await outsider.del(`/library/${item.id}`)).status, 404);
    });

    test('only approvers pre-approve, and editing the text clears it', async () => {
      assert.equal((await editor.post(`/library/${item.id}/approve`, {})).status, 403);
      const a = await owner.post(`/library/${item.id}/approve`, {});
      assert.equal(a.data.approved, true);
      assert.equal(a.data.approved_by_name, 'owner');
      const sameText = await editor.put(`/library/${item.id}`, { ...item, title: 'Weekly rate update' });
      assert.equal(sameText.data.approved, true, 'renaming keeps approval');
      const edited = await editor.put(`/library/${item.id}`, { ...item, body: 'New wording' });
      assert.equal(edited.data.approved, false);
      assert.equal(edited.data.approved_by, null);
    });

    test('brand filter, use count and delete', async () => {
      const other = (await owner.post('/brands', { name: 'Second brand' })).data;
      const scoped = (await editor.post('/library', { title: 'Only second', body: 'x', brand_id: other.id })).data;
      const forFirst = (await editor.get(`/library?brand_id=${brandId}`)).data.items.map((x) => x.id);
      assert.ok(forFirst.includes(item.id) && !forFirst.includes(scoped.id));
      const use = await editor.post(`/library/${item.id}/use`, {});
      assert.deepEqual(use.data, { body: 'New wording', media_ids: [] });
      assert.equal((await viewer.post(`/library/${item.id}/use`, {})).status, 403);
      assert.equal((await editor.get('/library')).data.items.find((x) => x.id === item.id).use_count, 1);
      assert.equal((await editor.del(`/library/${scoped.id}`)).status, 200);
      await owner.del(`/brands/${other.id}`);
    });
  });

  describe('monthly reports', () => {
    test('totals match the tables and compare with last month', async () => {
      const r = (await viewer.get(`/reports/monthly?brand_id=${brandId}`)).data;
      assert.match(r.month, /^\d{4}-\d{2}$/);
      assert.equal(r.timezone, 'Asia/Kolkata');
      const { rows: [c] } = await ctx.db.pool.query(
        `SELECT count(*) FILTER (WHERE created_at >= $2 AND created_at < $3) AS created,
                count(*) FILTER (WHERE status = 'published' AND published_at >= $2 AND published_at < $3) AS published
         FROM posts WHERE brand_id = $1`, [brandId, r.period.start, r.period.end]);
      assert.equal(r.totals.created, c.created);
      assert.equal(r.totals.published, c.published);
      assert.ok(r.totals.created > 0);
      assert.equal(r.daily.reduce((n, d) => n + d.published, 0), c.published);
      assert.ok(r.daily.length >= 28 && r.daily.length <= 31);
      const loansOn = (await viewer.get('/me')).data.workspace.loans_enabled;
      assert.ok('created' in r.previous);
      assert.equal('reminders_sent' in r.totals, loansOn, 'loan figures only when loans are on');
      assert.deepEqual(r.by_brand, []);
    });

    test('all brands, bad months and other workspaces', async () => {
      const all = (await owner.get('/reports/monthly')).data;
      assert.ok(all.by_brand.length >= 1 && all.brand === null);
      const old = (await owner.get('/reports/monthly?month=2020-01')).data;
      assert.equal(old.totals.created, 0);
      assert.equal(old.daily.length, 31);
      assert.equal((await owner.get('/reports/monthly?month=2020-13')).status, 400);
      assert.equal((await owner.get('/reports/monthly?month=2999-01')).status, 400);
      assert.equal((await outsider.get(`/reports/monthly?brand_id=${brandId}`)).status, 404);
      assert.equal((await anon.get('/reports/monthly')).status, 401);
    });
  });

  describe('AI', () => {
    test('drafting without a key returns 503 with guidance', { skip: !!process.env.ANTHROPIC_API_KEY }, async () => {
      const r = await editor.post('/ai/drafts', { brand_id: brandId, brief: 'launch' });
      assert.equal(r.status, 503);
      assert.match(r.data.error, /AI provider in Setup/);
    });

    test('viewers cannot use AI', async () => {
      assert.equal((await viewer.post('/ai/drafts', { brand_id: brandId, brief: 'x' })).status, 403);
    });
  });

  describe('analytics', () => {
    test('counts match the posts table', async () => {
      const a = (await owner.get(`/analytics?brand_id=${brandId}`)).data;
      const { rows } = await ctx.db.pool.query(
        `SELECT status, count(*) FROM posts WHERE brand_id = $1 GROUP BY status`, [brandId]);
      assert.deepEqual(a.by_status, Object.fromEntries(rows.map((r) => [r.status, r.count])));
      assert.ok(a.weekly.every((w) => /^\d{4}-\d{2}-\d{2}$/.test(w.week)));
    });
  });
});

if (skip) console.log(`# ${skip}`);
