require('dotenv/config');

const express = require('express');
const cors = require('cors');
const { clerkMiddleware } = require('@clerk/express');

const { errorHandler } = require('./middleware');
const { router: applicationsRouter } = require('./routes/applications');
const { router: listingsRouter, importAllFeeds } = require('./routes/listings');
const { router: preferencesRouter } = require('./routes/preferences');
const { router: matchRouter } = require('./routes/match');
const { aiAvailable, MODEL } = require('./lib/matcher');

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const REFRESH_HOURS = Number(process.env.LISTING_REFRESH_HOURS) || 6;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(clerkMiddleware());

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    matching: aiAvailable() ? { engine: 'claude', model: MODEL } : { engine: 'heuristic' },
  });
});

app.use('/applications', applicationsRouter);
app.use('/listings', listingsRouter);
app.use('/preferences', preferencesRouter);
app.use('/match', matchRouter);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(
    aiAvailable()
      ? `Matching engine: Claude (${MODEL})`
      : 'Matching engine: heuristic (set ANTHROPIC_API_KEY to enable Claude matching)',
  );

  // Keep the feed reasonably current without a separate scheduler process.
  if (process.env.DISABLE_AUTO_IMPORT !== 'true') {
    const refresh = () => {
      importAllFeeds()
        .then((results) => {
          const summary = results
            .map((r) => (r.error ? `${r.feed}: failed` : `${r.feed}: +${r.created}/~${r.updated}`))
            .join(', ');
          console.log(`[import] ${summary}`);
        })
        .catch((error) => console.error('[import] refresh failed:', error.message));
    };
    setTimeout(refresh, 5000).unref?.();
    setInterval(refresh, REFRESH_HOURS * 3600 * 1000).unref?.();
  }
});
