import { migrate, pool } from './db.js';
import { createApp } from './app.js';
import { startPublisher } from './publisher.js';
import { cleanupStaleUploads } from './media.js';
import { startReminders } from './loans.js';

const PORT = Number(process.env.PORT) || 3000;

try {
  await migrate();
} catch (err) {
  console.error(`\nCould not connect to PostgreSQL: ${err.message}`);
  console.error('Set DATABASE_URL in .env (see .env.example) and make sure the server is running.\n');
  process.exit(1);
}

const timer = startPublisher();
const reminders = startReminders();
const cleanup = setInterval(
  () => cleanupStaleUploads().catch((err) => console.error('[media cleanup]', err)), 60 * 60_000);
const server = createApp().listen(PORT, () => console.log(`Nexora running at http://localhost:${PORT}`));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    clearInterval(timer);
    clearInterval(cleanup);
    clearInterval(reminders);
    server.close(() => pool.end().then(() => process.exit(0)));
  });
}
