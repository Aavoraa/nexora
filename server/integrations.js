// Setup: credentials for social networks and messaging providers (PRD Features 9 and 12).
// Admins save their own developer-app details here. They are encrypted at rest and never
// returned to the browser. Connecting (OAuth) and delivery adapters are not built yet.
import crypto from 'node:crypto';
import express from 'express';
import { many, one, pool, logActivity } from './db.js';
import { requireRole } from './auth.js';
import { PLATFORMS } from './platforms.js';

export const integrations = express.Router();

const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const fail = (status, message) => { throw Object.assign(new Error(message), { status, expose: true }); };

// ---------- encryption (AES-256-GCM) ----------

function encryptionKey() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
}
export const encryptionReady = () => !!encryptionKey();

export function encrypt(obj) {
  const key = encryptionKey();
  if (!key) fail(503, 'Saving credentials needs TOKEN_ENCRYPTION_KEY (32 bytes, base64) in .env. See .env.example.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

export function decrypt(blob) {
  const key = encryptionKey();
  if (!key) fail(503, 'TOKEN_ENCRYPTION_KEY is not set');
  const [v, iv, tag, data] = blob.split(':');
  if (v !== 'v1') fail(500, 'Unknown credential format');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8'));
}

// ---------- catalogue ----------

const META_FIELDS = [['client_id', 'App ID'], ['client_secret', 'App secret', true]];
const OAUTH_FIELDS = [['client_id', 'Client ID'], ['client_secret', 'Client secret', true]];

/** What each integration needs, what it supports, and where to set it up. */
export const CATALOGUE = {
  social: {
    instagram: { supports: ['image', 'video', 'carousel'], fields: META_FIELDS, portal: 'https://developers.facebook.com/apps/',
      steps: ['Use an Instagram professional (Business or Creator) account linked to a Facebook Page.',
        'Create an app in Meta for Developers and add the Instagram product.',
        'Request the content-publishing permission through App Review and complete Business Verification.',
        'Copy the App ID and App secret here.'] },
    facebook: { label: 'Facebook Page', supports: ['text', 'image', 'video', 'link'], fields: META_FIELDS, portal: 'https://developers.facebook.com/apps/',
      steps: ['You need admin access to the Facebook Page you will post to.',
        'Create an app in Meta for Developers (the same app can serve Instagram).',
        'Request the Page posting permissions through App Review and complete Business Verification.',
        'Copy the App ID and App secret here.'] },
    youtube: { supports: ['video'], fields: OAUTH_FIELDS, portal: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com',
      steps: ['Create a Google Cloud project and enable the YouTube Data API v3.',
        'Configure the OAuth consent screen (uploads need app verification for public use).',
        'Create an OAuth client ID of type “Web application”.',
        'Copy the Client ID and Client secret here.'] },
    x: { label: 'X', supports: ['text', 'image', 'video'], fields: OAUTH_FIELDS, portal: 'https://developer.x.com/en/portal/dashboard',
      steps: ['Sign up for the X developer portal. Posting requires a paid API access tier.',
        'Create a project and app, and enable OAuth 2.0 with read and write permissions.',
        'Copy the OAuth 2.0 Client ID and Client secret here.'] },
    linkedin: { supports: ['text', 'image', 'video'], fields: OAUTH_FIELDS, portal: 'https://www.linkedin.com/developers/apps',
      steps: ['Create an app in LinkedIn Developers and link it to your company page.',
        'Request access to the posting products (Community Management API for company pages).',
        'Copy the Client ID and Client secret from the Auth tab here.'] },
    threads: { supports: ['text', 'image', 'video'], fields: META_FIELDS, portal: 'https://developers.facebook.com/apps/',
      steps: ['Create an app in Meta for Developers with the Threads API use case.',
        'Request the Threads publishing permission through App Review.',
        'Copy the Threads App ID and App secret here.'] },
    tiktok: { supports: ['video'], fields: [['client_id', 'Client key'], ['client_secret', 'Client secret', true]], portal: 'https://developers.tiktok.com/apps/',
      steps: ['Register on TikTok for Developers and create an app.',
        'Add the Content Posting API product and submit the app for review.',
        'Copy the Client key and Client secret here.'] },
    pinterest: { supports: ['image', 'video'], fields: [['client_id', 'App ID'], ['client_secret', 'App secret key', true]], portal: 'https://developers.pinterest.com/apps/',
      steps: ['Use a Pinterest business account and create an app in Pinterest Developers.',
        'Request Standard access so the app can create Pins.',
        'Copy the App ID and App secret key here.'] },
  },
  messaging: {
    sms: { label: 'SMS', supports: ['text'], providers: ['MSG91', 'Twilio', 'Gupshup', 'Other'],
      fields: [['provider', 'Provider'], ['api_key', 'API key', true], ['sender', 'Sender ID or number']],
      steps: ['Open an account with an SMS provider.',
        'In India, register on a DLT platform and get your sender ID (header) and message templates approved.',
        'Copy the API key and sender ID here.'] },
    whatsapp: { label: 'WhatsApp', supports: ['text', 'templates'], providers: ['Meta WhatsApp Cloud API', 'Twilio', 'Gupshup', 'Other'],
      fields: [['provider', 'Provider'], ['api_key', 'Access token', true], ['sender', 'Phone number ID']],
      steps: ['Set up a WhatsApp Business account (Meta Business Manager) with a dedicated phone number.',
        'Get your reminder message templates approved: business-initiated messages must use templates.',
        'Copy the access token and phone number ID here.'] },
    email: { label: 'Email', supports: ['text', 'html'], providers: ['Resend', 'Amazon SES', 'SendGrid', 'Other'],
      fields: [['provider', 'Provider'], ['api_key', 'API key', true], ['sender', 'From address']],
      steps: ['Open an account with an email provider.',
        'Verify your sending domain (SPF and DKIM DNS records).',
        'Copy the API key and the from address here.'] },
  },
};

const labelFor = (kind, key) => CATALOGUE[kind][key].label || PLATFORMS[key]?.label || key;

/** Public description of every integration, merged with this workspace's saved state. */
async function describe(workspaceId) {
  const saved = await many(`SELECT i.kind, i.key, i.hint, i.updated_at, u.display_name AS updated_by_name
    FROM integration_credentials i LEFT JOIN users u ON u.id = i.updated_by WHERE i.workspace_id = $1`, [workspaceId]);
  const out = {};
  for (const [kind, items] of Object.entries(CATALOGUE)) {
    out[kind] = Object.entries(items).map(([key, it]) => {
      const s = saved.find((r) => r.kind === kind && r.key === key);
      return {
        key, label: labelFor(kind, key), supports: it.supports, portal: it.portal || null, steps: it.steps,
        providers: it.providers || null,
        fields: it.fields.map(([name, label, secret]) => ({ name, label, secret: !!secret })),
        configured: !!s, hint: s?.hint || '', updated_at: s?.updated_at || null, updated_by: s?.updated_by_name || null,
        // Neither OAuth connection nor delivery adapters exist yet.
        available: false, connected: false,
      };
    });
  }
  return out;
}

const spec = (kind, key) => (CATALOGUE[kind]?.[key] ? CATALOGUE[kind][key] : fail(404, 'Unknown integration'));

integrations.get('/', ah(async (req, res) => {
  res.json({ ...(await describe(req.user.workspace_id)), encryption_ready: encryptionReady() });
}));

integrations.put('/:kind/:key', requireRole('admin'), ah(async (req, res) => {
  const it = spec(req.params.kind, req.params.key);
  const existing = await one('SELECT data_enc FROM integration_credentials WHERE workspace_id = $1 AND kind = $2 AND key = $3',
    [req.user.workspace_id, req.params.kind, req.params.key]);
  const previous = existing ? decrypt(existing.data_enc) : {};
  const data = {};
  for (const [name, label, secret] of it.fields) {
    let v = typeof req.body[name] === 'string' ? req.body[name].trim().slice(0, 500) : '';
    // Leaving a secret blank on edit keeps the saved one.
    if (!v && secret && previous[name]) v = previous[name];
    if (!v) fail(400, `${label} is required`);
    if (name === 'provider' && it.providers && !it.providers.includes(v)) fail(400, 'Choose a provider from the list');
    data[name] = v;
  }
  const visible = data.client_id || data.sender || '';
  const hint = [data.provider, visible ? `…${visible.slice(-4)}` : ''].filter(Boolean).join(' · ');
  await pool.query(`
    INSERT INTO integration_credentials (workspace_id, kind, key, data_enc, hint, updated_by, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6, now())
    ON CONFLICT (workspace_id, kind, key) DO UPDATE SET data_enc = EXCLUDED.data_enc, hint = EXCLUDED.hint,
      updated_by = EXCLUDED.updated_by, updated_at = now()`,
  [req.user.workspace_id, req.params.kind, req.params.key, encrypt(data), hint, req.user.id]);
  await logActivity(req.user.workspace_id, req.user.id, 'setup.details_saved', labelFor(req.params.kind, req.params.key));
  res.json((await describe(req.user.workspace_id))[req.params.kind].find((x) => x.key === req.params.key));
}));

integrations.delete('/:kind/:key', requireRole('admin'), ah(async (req, res) => {
  spec(req.params.kind, req.params.key);
  await pool.query('DELETE FROM integration_credentials WHERE workspace_id = $1 AND kind = $2 AND key = $3',
    [req.user.workspace_id, req.params.kind, req.params.key]);
  await logActivity(req.user.workspace_id, req.user.id, 'setup.details_removed', labelFor(req.params.kind, req.params.key));
  res.json({ ok: true });
}));

integrations.post('/:kind/:key/connect', requireRole('admin'), ah(async (req) => {
  spec(req.params.kind, req.params.key);
  const name = labelFor(req.params.kind, req.params.key);
  fail(501, req.params.kind === 'social'
    ? `Connecting ${name} isn't available yet. The sign-in flow with ${name} is still being built (it also needs your app approved by ${name}). Your saved details will be used once it's ready.`
    : `Sending by ${name} isn't available yet. The ${name} delivery connection is still being built; until then messages are logged, not delivered.`);
}));
