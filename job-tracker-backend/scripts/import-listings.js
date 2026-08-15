// One-off feed import, for seeding a fresh database or forcing a refresh
// without waiting for the server's scheduled run: `npm run import`.
require('dotenv/config');

const prisma = require('../prisma');
const { importAllFeeds } = require('../routes/listings');

(async () => {
  const started = Date.now();
  const results = await importAllFeeds();

  for (const result of results) {
    if (result.error) {
      console.error(`✗ ${result.label}: ${result.error}`);
    } else {
      console.log(
        `✓ ${result.label}: ${result.fetched} fetched, ${result.created} new, ` +
          `${result.updated} changed, ${result.unchanged} unchanged`,
      );
    }
  }

  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  await prisma.$disconnect();
  process.exit(results.some((r) => r.error) ? 1 : 0);
})();
