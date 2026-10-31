import { tx, logActivity } from './db.js';

/**
 * Publish adapters, keyed by platform. Real network integrations (OAuth + API
 * calls) plug in here; until one exists for a platform, the simulated adapter
 * records the publish without contacting the network.
 */
const adapters = {};

async function simulatedPublish(post, channel) {
  console.log(`[publisher] (simulated) post #${post.id} -> ${channel.platform}:${channel.handle}`);
}

async function publishOne(client, post) {
  const { rows: channels } = await client.query(
    'SELECT * FROM channels WHERE id = ANY($1::int[]) AND brand_id = $2',
    [post.channel_ids, post.brand_id],
  );
  if (channels.length === 0) throw new Error('No channels selected');
  for (const ch of channels) {
    await (adapters[ch.platform] || simulatedPublish)(post, ch);
  }
}

/** Publish every scheduled post that is due. Safe to run from several processes. */
export async function runDuePosts() {
  await tx(async (client) => {
    const { rows } = await client.query(`
      SELECT p.*, b.workspace_id FROM posts p JOIN brands b ON b.id = p.brand_id
      WHERE p.status = 'scheduled' AND p.scheduled_at <= now()
      ORDER BY p.scheduled_at
      LIMIT 50
      FOR UPDATE OF p SKIP LOCKED`);
    for (const post of rows) {
      try {
        await publishOne(client, post);
        await client.query(
          `UPDATE posts SET status = 'published', published_at = now(), updated_at = now() WHERE id = $1`,
          [post.id]);
        await logActivity(post.workspace_id, null, 'post.published', `Post #${post.id}`);
      } catch (err) {
        await client.query(
          `UPDATE posts SET status = 'failed', review_note = $2, updated_at = now() WHERE id = $1`,
          [post.id, String(err.message || err)]);
        await logActivity(post.workspace_id, null, 'post.failed', `Post #${post.id}: ${err.message}`);
      }
    }
  });
}

export function startPublisher(intervalMs = 15_000) {
  const tick = () => runDuePosts().catch((err) => console.error('[publisher]', err));
  tick();
  return setInterval(tick, intervalMs);
}
