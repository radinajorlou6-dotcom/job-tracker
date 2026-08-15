const express = require('express');
const { getAuth } = require('@clerk/express');
const prisma = require('../prisma');
const { requireUser, asyncHandler, httpError } = require('../middleware');
const { getPreferences } = require('./preferences');
const { prefsHash, scoreListings, MODEL } = require('../lib/matcher');
const { resolveApiKey, getStatus } = require('../lib/credentials');

const router = express.Router();

// Scoring a few hundred listings takes longer than one HTTP request should, so
// runs happen in the background and the client polls this state.
const jobs = new Map();

function jobState(userId) {
  return jobs.get(userId) ?? null;
}

async function coverage(userId, hash) {
  const [totalActive, fresh, stale] = await Promise.all([
    prisma.listing.count({ where: { active: true, isVisible: true } }),
    prisma.listingMatch.count({ where: { userId, prefsHash: hash } }),
    prisma.listingMatch.count({ where: { userId, prefsHash: { not: hash } } }),
  ]);
  return { totalActive, scored: fresh, stale, unscored: Math.max(0, totalActive - fresh - stale) };
}

async function runMatching(userId, { limit, rescoreAll }) {
  const preferences = await getPreferences(userId);
  // Resolved per run, so a key added mid-session takes effect immediately.
  const { key: apiKey } = await resolveApiKey(userId);
  const hash = prefsHash(preferences, { ai: Boolean(apiKey) });

  const where = { active: true, isVisible: true };
  if (!rescoreAll) {
    // Skip anything already scored under the current preference set.
    where.NOT = { matches: { some: { userId, prefsHash: hash } } };
  }

  const listings = await prisma.listing.findMany({
    where,
    orderBy: [{ datePosted: 'desc' }, { id: 'desc' }],
    take: limit,
  });

  const job = jobs.get(userId);
  job.total = listings.length;

  if (listings.length === 0) {
    job.status = 'done';
    job.finishedAt = new Date().toISOString();
    return;
  }

  const { results, degraded } = await scoreListings(listings, preferences, {
    apiKey,
    onProgress: ({ done }) => {
      job.done = done;
    },
  });

  for (const result of results) {
    await prisma.listingMatch.upsert({
      where: { userId_listingId: { userId, listingId: result.listingId } },
      update: {
        score: result.score,
        verdict: result.verdict,
        reasons: result.reasons,
        concerns: result.concerns,
        summary: result.summary,
        engine: result.engine,
        model: result.model,
        prefsHash: hash,
        computedAt: new Date(),
      },
      create: {
        userId,
        listingId: result.listingId,
        score: result.score,
        verdict: result.verdict,
        reasons: result.reasons,
        concerns: result.concerns,
        summary: result.summary,
        engine: result.engine,
        model: result.model,
        prefsHash: hash,
      },
    });
  }

  job.degraded = degraded;
  job.scored = results.length;
  job.status = 'done';
  job.finishedAt = new Date().toISOString();
}

router.get(
  '/status',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = getAuth(req).userId;
    const [preferences, credentials] = await Promise.all([
      getPreferences(userId),
      getStatus(userId),
    ]);
    const hash = prefsHash(preferences, { ai: credentials.aiEnabled });

    res.json({
      job: jobState(userId),
      engine: {
        ai: credentials.aiEnabled,
        source: credentials.source,
        model: credentials.aiEnabled ? MODEL : 'heuristic',
      },
      coverage: await coverage(userId, hash),
    });
  }),
);

router.post(
  '/run',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = getAuth(req).userId;
    const existing = jobs.get(userId);
    if (existing?.status === 'running') {
      throw httpError(409, 'A match run is already in progress');
    }

    const limit = Math.min(400, Math.max(1, Number(req.body?.limit) || 100));
    const rescoreAll = Boolean(req.body?.rescoreAll);
    const credentials = await getStatus(userId);

    const job = {
      status: 'running',
      total: 0,
      done: 0,
      scored: 0,
      degraded: null,
      error: null,
      engine: credentials.aiEnabled ? `claude (${MODEL})` : 'heuristic',
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    jobs.set(userId, job);

    // Deliberately not awaited: the client polls /match/status for progress.
    runMatching(userId, { limit, rescoreAll }).catch((error) => {
      console.error('[match] run failed:', error);
      job.status = 'error';
      job.error = error.message;
      job.finishedAt = new Date().toISOString();
    });

    res.status(202).json({ job });
  }),
);

module.exports = { router };
