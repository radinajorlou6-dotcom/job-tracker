const express = require('express');
const { getAuth } = require('@clerk/express');
const prisma = require('../prisma');
const { requireUser, asyncHandler } = require('../middleware');
const { prefsHash, aiAvailable, MODEL } = require('../lib/matcher');

const router = express.Router();

const REMOTE_OPTIONS = ['any', 'remote', 'hybrid', 'onsite'];

const DEFAULT_PREFERENCES = {
  headline: '',
  desiredRoles: [],
  preferredLocations: [],
  remotePreference: 'any',
  terms: [],
  degrees: [],
  categories: [],
  needsSponsorship: false,
  excludedCompanies: [],
  mustHaves: '',
  dealBreakers: '',
  values: '',
};

function cleanList(value) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((v) => typeof v === 'string')
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ].slice(0, 40);
}

function cleanText(value, max = 2000) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.slice(0, max);
}

function shape(record) {
  if (!record) return { ...DEFAULT_PREFERENCES, exists: false };
  return {
    headline: record.headline ?? '',
    desiredRoles: record.desiredRoles,
    preferredLocations: record.preferredLocations,
    remotePreference: record.remotePreference,
    terms: record.terms,
    degrees: record.degrees,
    categories: record.categories,
    needsSponsorship: record.needsSponsorship,
    excludedCompanies: record.excludedCompanies,
    mustHaves: record.mustHaves ?? '',
    dealBreakers: record.dealBreakers ?? '',
    values: record.values ?? '',
    updatedAt: record.updatedAt,
    exists: true,
  };
}

async function getPreferences(userId) {
  const record = await prisma.userPreferences.findUnique({ where: { userId } });
  return record ?? { ...DEFAULT_PREFERENCES, userId };
}

router.get(
  '/',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = getAuth(req).userId;
    const record = await prisma.userPreferences.findUnique({ where: { userId } });
    res.json({
      preferences: shape(record),
      engine: {
        ai: aiAvailable(),
        model: aiAvailable() ? MODEL : null,
        prefsHash: prefsHash(record ?? DEFAULT_PREFERENCES),
      },
    });
  }),
);

router.put(
  '/',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = getAuth(req).userId;
    const body = req.body ?? {};

    const data = {
      headline: cleanText(body.headline, 600),
      desiredRoles: cleanList(body.desiredRoles),
      preferredLocations: cleanList(body.preferredLocations),
      remotePreference: REMOTE_OPTIONS.includes(body.remotePreference)
        ? body.remotePreference
        : 'any',
      terms: cleanList(body.terms),
      degrees: cleanList(body.degrees),
      categories: cleanList(body.categories),
      needsSponsorship: Boolean(body.needsSponsorship),
      excludedCompanies: cleanList(body.excludedCompanies),
      mustHaves: cleanText(body.mustHaves),
      dealBreakers: cleanText(body.dealBreakers),
      values: cleanText(body.values),
    };

    const record = await prisma.userPreferences.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });

    const hash = prefsHash(record);
    // Anything scored under a different preference set is now stale. We report
    // it rather than deleting, so the feed keeps working until a re-run.
    const staleMatches = await prisma.listingMatch.count({
      where: { userId, prefsHash: { not: hash } },
    });

    res.json({
      preferences: shape(record),
      engine: { ai: aiAvailable(), model: aiAvailable() ? MODEL : null, prefsHash: hash },
      staleMatches,
    });
  }),
);

module.exports = { router, getPreferences, DEFAULT_PREFERENCES, REMOTE_OPTIONS };
