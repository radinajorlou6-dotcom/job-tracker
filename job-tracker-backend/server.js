require('dotenv/config');

const express = require('express');
const cors = require('cors');
const { clerkMiddleware } = require('@clerk/express');

const { errorHandler } = require('./middleware');
const { router: applicationsRouter } = require('./routes/applications');
const { router: listingsRouter, importAllFeeds } = require('./routes/listings');
const { router: preferencesRouter } = require('./routes/preferences');
const { router: matchRouter } = require('./routes/match');
const { router: settingsRouter } = require('./routes/settings');
const { MODEL } = require('./lib/matcher');
const { isConfigured } = require('./lib/crypto');

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const REFRESH_HOURS = Number(process.env.LISTING_REFRESH_HOURS) || 6;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(clerkMiddleware());

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    model: MODEL,
    // Whether users can store their own keys, and whether a shared fallback exists.
    byoKey: isConfigured(),
    serverKey: Boolean(process.env.ANTHROPIC_API_KEY),
  });
});

app.use('/applications', applicationsRouter);
app.use('/listings', listingsRouter);
app.use('/preferences', preferencesRouter);
app.use('/match', matchRouter);
app.use('/settings', settingsRouter);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  if (isConfigured()) {
    console.log(`Matching: users can add their own Anthropic key (${MODEL})`);
  } else {
    console.warn(
      'Matching: CREDENTIAL_SECRET is not set, so users cannot save their own API keys. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  if (process.env.ANTHROPIC_API_KEY) {
    console.log('Matching: a server-wide key is set and will be used as a fallback');
  }

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
