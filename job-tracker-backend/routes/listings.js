const express = require('express');
const { getAuth } = require('@clerk/express');
const prisma = require('../prisma');
const { requireUser, asyncHandler } = require('../middleware');
const { FEEDS, FEED_KEYS, normalizeListing, contentHash } = require('../lib/listings');

const router = express.Router();

const CHUNK = 100;

function chunked(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Imports one feed. Rather than upserting every row (14k+ round trips), we read
 * the existing hashes once and only write rows that are genuinely new or changed.
 */
async function importFeed(feed) {
  const response = await fetch(feed.url);
  if (!response.ok) {
    throw new Error(`${feed.key}: upstream responded ${response.status}`);
  }
  const raw = await response.json();
  if (!Array.isArray(raw)) throw new Error(`${feed.key}: unexpected payload shape`);

  const existing = await prisma.listing.findMany({
    where: { feed: feed.key },
    select: { id: true, sourceId: true, contentHash: true },
  });
  const existingBySourceId = new Map(existing.map((row) => [row.sourceId, row]));

  const now = new Date();
  const toCreate = [];
  const toUpdate = [];
  const unchangedIds = [];

  for (const item of raw) {
    if (!item?.id) continue;
    const data = normalizeListing(item, feed.key);
    const hash = contentHash(data);
    const prior = existingBySourceId.get(item.id);

    if (!prior) {
      toCreate.push({
        ...data,
        sourceId: item.id,
        contentHash: hash,
        firstSeenAt: now,
        lastSeenAt: now,
      });
    } else if (prior.contentHash !== hash) {
      toUpdate.push({
        id: prior.id,
        data: { ...data, contentHash: hash, lastSeenAt: now, lastChangedAt: now },
      });
    } else {
      unchangedIds.push(prior.id);
    }
  }

  for (const batch of chunked(toCreate, CHUNK)) {
    await prisma.listing.createMany({ data: batch, skipDuplicates: true });
  }

  for (const batch of chunked(toUpdate, 25)) {
    await prisma.$transaction(
      batch.map(({ id, data }) => prisma.listing.update({ where: { id }, data })),
    );
  }

  for (const batch of chunked(unchangedIds, 500)) {
    await prisma.listing.updateMany({ where: { id: { in: batch } }, data: { lastSeenAt: now } });
  }

  return {
    feed: feed.key,
    label: feed.label,
    fetched: raw.length,
    created: toCreate.length,
    updated: toUpdate.length,
    unchanged: unchangedIds.length,
  };
}

async function importAllFeeds() {
  const results = [];
  for (const feed of FEEDS) {
    try {
      results.push(await importFeed(feed));
    } catch (error) {
      console.error('[import]', error.message);
      results.push({ feed: feed.key, label: feed.label, error: error.message });
    }
  }
  return results;
}

function parseList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

// Translates query params into a Prisma filter shared by both sort paths.
function buildListingWhere(query) {
  const where = {};
  const and = [];

  if (query.includeInactive !== 'true') {
    where.active = true;
    where.isVisible = true;
  }

  const feeds = parseList(query.feed).filter((f) => FEED_KEYS.includes(f));
  if (feeds.length > 0) where.feed = { in: feeds };

  const categories = parseList(query.category);
  if (categories.length > 0) where.category = { in: categories };

  const terms = parseList(query.term);
  if (terms.length > 0) where.terms = { hasSome: terms };

  const degrees = parseList(query.degree);
  if (degrees.length > 0) where.degrees = { hasSome: degrees };

  if (query.sponsorship === 'offered') {
    where.sponsorship = { contains: 'Offers Sponsorship', mode: 'insensitive' };
  } else if (query.sponsorship === 'no-citizenship') {
    and.push({ NOT: { sponsorship: { contains: 'Citizenship', mode: 'insensitive' } } });
  }

  if (query.location) {
    and.push({ locations: { has: query.location } });
  }

  if (query.q) {
    const q = String(query.q).trim();
    if (q) {
      and.push({
        OR: [
          { company: { contains: q, mode: 'insensitive' } },
          { role: { contains: q, mode: 'insensitive' } },
          { category: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
  }

  if (query.postedWithinDays) {
    const days = Number(query.postedWithinDays);
    if (Number.isFinite(days) && days > 0) {
      and.push({ datePosted: { gte: new Date(Date.now() - days * 86400000) } });
    }
  }

  if (and.length > 0) where.AND = and;
  return where;
}

function shapeListing(listing, match, appliedIds) {
  return {
    ...listing,
    match: match
      ? {
          score: match.score,
          verdict: match.verdict,
          reasons: match.reasons,
          concerns: match.concerns,
          summary: match.summary,
          engine: match.engine,
          computedAt: match.computedAt,
        }
      : null,
    applied: appliedIds.has(listing.id),
  };
}

router.get(
  '/feeds',
  asyncHandler(async (_req, res) => {
    const counts = await prisma.listing.groupBy({
      by: ['feed'],
      _count: { _all: true },
      where: { active: true, isVisible: true },
    });
    const countByFeed = new Map(counts.map((c) => [c.feed, c._count._all]));
    res.json(
      FEEDS.map((feed) => ({
        key: feed.key,
        label: feed.label,
        kind: feed.kind,
        activeCount: countByFeed.get(feed.key) ?? 0,
      })),
    );
  }),
);

// Distinct values for the filter controls. terms/degrees are array columns, so
// they need unnest rather than a plain distinct.
router.get(
  '/facets',
  asyncHandler(async (_req, res) => {
    const [categories, terms, degrees, locations] = await Promise.all([
      prisma.listing.findMany({
        where: { active: true, isVisible: true, category: { not: null } },
        distinct: ['category'],
        select: { category: true },
        orderBy: { category: 'asc' },
      }),
      prisma.$queryRaw`SELECT DISTINCT unnest("terms") AS value FROM "Listing" WHERE "active" = true ORDER BY value ASC LIMIT 60`,
      prisma.$queryRaw`SELECT DISTINCT unnest("degrees") AS value FROM "Listing" WHERE "active" = true ORDER BY value ASC LIMIT 60`,
      prisma.$queryRaw`SELECT unnest("locations") AS value, COUNT(*) AS count FROM "Listing" WHERE "active" = true GROUP BY value ORDER BY count DESC LIMIT 80`,
    ]);

    res.json({
      categories: categories.map((c) => c.category).filter(Boolean),
      terms: terms.map((t) => t.value).filter(Boolean),
      degrees: degrees.map((d) => d.value).filter(Boolean),
      locations: locations.map((l) => l.value).filter(Boolean),
    });
  }),
);

router.get(
  '/',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = getAuth(req).userId;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(60, Math.max(5, Number(req.query.pageSize) || 20));
    const skip = (page - 1) * pageSize;
    const sort = req.query.sort || 'recent';
    const where = buildListingWhere(req.query);

    let items = [];
    let total = 0;

    if (sort === 'match') {
      // Driving the query from ListingMatch is the only way to order by score,
      // since a listing's matches are a list relation from its own side.
      const matchWhere = { userId, listing: where };
      const minScore = Number(req.query.minScore);
      if (Number.isFinite(minScore)) matchWhere.score = { gte: minScore };

      const [matches, count] = await Promise.all([
        prisma.listingMatch.findMany({
          where: matchWhere,
          orderBy: [{ score: 'desc' }, { listingId: 'asc' }],
          skip,
          take: pageSize,
          include: { listing: true },
        }),
        prisma.listingMatch.count({ where: matchWhere }),
      ]);

      total = count;
      const listingIds = matches.map((m) => m.listingId);
      const applied = await prisma.application.findMany({
        where: { userId, listingId: { in: listingIds } },
        select: { listingId: true },
      });
      const appliedIds = new Set(applied.map((a) => a.listingId));
      items = matches.map((m) => shapeListing(m.listing, m, appliedIds));
    } else {
      const orderBy =
        sort === 'company'
          ? [{ company: 'asc' }, { id: 'asc' }]
          : [{ datePosted: 'desc' }, { id: 'desc' }];

      const [listings, count] = await Promise.all([
        prisma.listing.findMany({
          where,
          orderBy,
          skip,
          take: pageSize,
          include: { matches: { where: { userId }, take: 1 } },
        }),
        prisma.listing.count({ where }),
      ]);

      total = count;
      const listingIds = listings.map((l) => l.id);
      const applied = await prisma.application.findMany({
        where: { userId, listingId: { in: listingIds } },
        select: { listingId: true },
      });
      const appliedIds = new Set(applied.map((a) => a.listingId));
      items = listings.map(({ matches, ...listing }) =>
        shapeListing(listing, matches[0] ?? null, appliedIds),
      );
    }

    res.json({ items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 1 });
  }),
);

router.get(
  '/:id',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = getAuth(req).userId;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid listing id' });

    const listing = await prisma.listing.findUnique({
      where: { id },
      include: { matches: { where: { userId }, take: 1 } },
    });
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    const application = await prisma.application.findFirst({
      where: { userId, listingId: id },
      select: { id: true },
    });

    const { matches, ...rest } = listing;
    res.json(shapeListing(rest, matches[0] ?? null, new Set(application ? [id] : [])));
  }),
);

router.post(
  '/import',
  requireUser,
  asyncHandler(async (_req, res) => {
    const results = await importAllFeeds();
    res.json({ results, importedAt: new Date().toISOString() });
  }),
);

module.exports = { router, importAllFeeds, importFeed };
