const express = require('express');
const { getAuth } = require('@clerk/express');
const prisma = require('../prisma');
const { requireUser, asyncHandler, httpError } = require('../middleware');
const { listingToApplicationFields, snapshotOf, diffSnapshot } = require('../lib/listings');

const router = express.Router();

const STATUSES = ['Applied', 'Interviewing', 'Offered', 'Rejected'];

// Fields a client may set directly. Anything outside this list is ignored so a
// stray key can never overwrite userId, snapshot state, or the listing link.
const EDITABLE_STRING_FIELDS = [
  'company',
  'role',
  'category',
  'url',
  'companyUrl',
  'sponsorship',
  'salary',
  'notes',
  'source',
  'sourceId',
];
const EDITABLE_ARRAY_FIELDS = ['terms', 'locations', 'degrees'];
const EDITABLE_DATE_FIELDS = ['dateApplied', 'datePosted'];

function cleanArray(value) {
  if (!Array.isArray(value)) return undefined;
  return value.filter((v) => typeof v === 'string' && v.trim() !== '').map((v) => v.trim());
}

function parseDate(value) {
  if (value === null) return null;
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function pickEditableFields(body) {
  const data = {};
  for (const field of EDITABLE_STRING_FIELDS) {
    if (field in body) {
      const value = body[field];
      data[field] = typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
    }
  }
  for (const field of EDITABLE_ARRAY_FIELDS) {
    if (field in body) {
      const value = cleanArray(body[field]);
      if (value !== undefined) data[field] = value;
    }
  }
  for (const field of EDITABLE_DATE_FIELDS) {
    if (field in body) {
      const value = parseDate(body[field]);
      if (value !== undefined) data[field] = value;
    }
  }
  return data;
}

// An application has a pending upstream change when its linked listing's
// current content differs from both the snapshot taken at apply time and
// whatever the user last dismissed.
function hasUpstreamChange(application) {
  const listing = application.listing;
  if (!listing?.contentHash || !application.snapshotHash) return false;
  return (
    listing.contentHash !== application.snapshotHash &&
    listing.contentHash !== application.dismissedHash
  );
}

function shapeApplication(application) {
  const { listing, ...rest } = application;
  return {
    ...rest,
    hasUpstreamChange: hasUpstreamChange(application),
    listingActive: listing ? listing.active : null,
    listingLastChangedAt: listing ? listing.lastChangedAt : null,
  };
}

const LISTING_SELECT = {
  select: { id: true, contentHash: true, lastChangedAt: true, active: true },
};

router.get(
  '/',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = getAuth(req).userId;
    const where = { userId };

    const statuses = String(req.query.status || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => STATUSES.includes(s));
    if (statuses.length > 0) where.status = { in: statuses };

    if (req.query.q) {
      const q = String(req.query.q).trim();
      if (q) {
        where.OR = [
          { company: { contains: q, mode: 'insensitive' } },
          { role: { contains: q, mode: 'insensitive' } },
          { notes: { contains: q, mode: 'insensitive' } },
        ];
      }
    }

    const sort = req.query.sort || 'recent';
    const orderBy =
      sort === 'company'
        ? [{ company: 'asc' }, { id: 'asc' }]
        : sort === 'status'
          ? [{ status: 'asc' }, { dateApplied: 'desc' }]
          : [{ dateApplied: 'desc' }, { id: 'desc' }];

    const applications = await prisma.application.findMany({
      where,
      orderBy,
      include: { listing: LISTING_SELECT },
    });

    res.json(applications.map(shapeApplication));
  }),
);

// Registered before /:id so "analytics" isn't parsed as an application id.
router.get(
  '/analytics',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = getAuth(req).userId;
    const days = Math.min(365, Math.max(14, Number(req.query.days) || 90));
    const since = new Date(Date.now() - days * 86400000);

    const [applications, statusEvents] = await Promise.all([
      prisma.application.findMany({
        where: { userId },
        select: {
          id: true,
          status: true,
          company: true,
          category: true,
          source: true,
          dateApplied: true,
          createdAt: true,
          listingId: true,
        },
      }),
      prisma.applicationEvent.findMany({
        where: { userId, type: 'status' },
        orderBy: { createdAt: 'asc' },
        select: { applicationId: true, toStatus: true, createdAt: true },
      }),
    ]);

    const total = applications.length;

    const statusCounts = STATUSES.map((status) => ({
      status,
      count: applications.filter((a) => a.status === status).length,
    }));

    // Daily buckets across the whole window, including zero days, so the chart
    // has a continuous x-axis rather than gaps.
    const buckets = new Map();
    for (let i = 0; i < days; i += 1) {
      const day = new Date(since.getTime() + i * 86400000);
      buckets.set(day.toISOString().slice(0, 10), 0);
    }
    for (const app of applications) {
      const when = app.dateApplied ?? app.createdAt;
      if (!when || when < since) continue;
      const key = new Date(when).toISOString().slice(0, 10);
      if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1);
    }

    let running = applications.filter((a) => {
      const when = a.dateApplied ?? a.createdAt;
      return when && when < since;
    }).length;
    const overTime = [...buckets.entries()].map(([date, count]) => {
      running += count;
      return { date, count, cumulative: running };
    });

    // First status change per application is the moment the employer responded.
    const firstResponseByApp = new Map();
    for (const event of statusEvents) {
      if (!firstResponseByApp.has(event.applicationId)) {
        firstResponseByApp.set(event.applicationId, event);
      }
    }

    const appliedAtById = new Map(
      applications.map((a) => [a.id, a.dateApplied ?? a.createdAt]),
    );
    const responseTimes = [];
    for (const [applicationId, event] of firstResponseByApp) {
      const appliedAt = appliedAtById.get(applicationId);
      if (!appliedAt) continue;
      const deltaDays = (event.createdAt.getTime() - new Date(appliedAt).getTime()) / 86400000;
      if (deltaDays >= 0) responseTimes.push(deltaDays);
    }

    const responded = applications.filter((a) => a.status !== 'Applied').length;
    const interviewing = applications.filter((a) => a.status === 'Interviewing').length;
    const offered = applications.filter((a) => a.status === 'Offered').length;
    const rejected = applications.filter((a) => a.status === 'Rejected').length;

    const countBy = (list, key) => {
      const map = new Map();
      for (const item of list) {
        const value = item[key];
        if (!value) continue;
        map.set(value, (map.get(value) ?? 0) + 1);
      }
      return [...map.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
    };

    const importedCount = applications.filter((a) => a.listingId != null).length;

    res.json({
      totals: {
        total,
        responded,
        interviewing,
        offered,
        rejected,
        active: total - rejected,
        imported: importedCount,
        manual: total - importedCount,
        responseRate: total > 0 ? responded / total : 0,
        interviewRate: total > 0 ? (interviewing + offered) / total : 0,
        offerRate: total > 0 ? offered / total : 0,
        medianDaysToResponse:
          responseTimes.length > 0
            ? Number(
                [...responseTimes].sort((a, b) => a - b)[Math.floor(responseTimes.length / 2)]
                  .toFixed(1),
              )
            : null,
      },
      statusCounts,
      overTime,
      funnel: [
        { stage: 'Applied', count: total },
        { stage: 'Responded', count: responded },
        { stage: 'Interviewing', count: interviewing + offered },
        { stage: 'Offered', count: offered },
      ],
      topCompanies: countBy(applications, 'company').slice(0, 8),
      byCategory: countBy(applications, 'category').slice(0, 8),
      windowDays: days,
    });
  }),
);

// Everything with a pending upstream edit, so the tracker can show one badge
// without fetching each diff separately.
router.get(
  '/updates',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = getAuth(req).userId;
    const applications = await prisma.application.findMany({
      where: { userId, listingId: { not: null } },
      include: { listing: true },
    });

    const pending = applications
      .filter((application) => hasUpstreamChange(application))
      .map((application) => ({
        applicationId: application.id,
        company: application.company,
        role: application.role,
        changedAt: application.listing.lastChangedAt,
        changes: diffSnapshot(application.snapshot, application.listing),
      }))
      .filter((entry) => entry.changes.length > 0);

    res.json(pending);
  }),
);

router.get(
  '/:id',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = getAuth(req).userId;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw httpError(400, 'Invalid application id');

    const application = await prisma.application.findFirst({
      where: { id, userId },
      include: {
        listing: true,
        events: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!application) throw httpError(404, 'Application not found');

    const { listing, events, ...rest } = application;
    res.json({
      ...rest,
      events,
      hasUpstreamChange: hasUpstreamChange(application),
      listingActive: listing ? listing.active : null,
      listingLastChangedAt: listing ? listing.lastChangedAt : null,
      upstreamChanges: listing ? diffSnapshot(application.snapshot, listing) : [],
    });
  }),
);

router.post(
  '/',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = getAuth(req).userId;
    const data = pickEditableFields(req.body ?? {});

    if (!data.company && !data.role) {
      throw httpError(400, 'An application needs at least a company or a role');
    }

    const status = STATUSES.includes(req.body?.status) ? req.body.status : 'Applied';
    if (!data.dateApplied) data.dateApplied = new Date();

    const application = await prisma.$transaction(async (tx) => {
      const created = await tx.application.create({
        data: { ...data, status, userId },
      });
      await tx.applicationEvent.create({
        data: {
          applicationId: created.id,
          userId,
          type: 'created',
          toStatus: status,
          detail: 'Added manually',
        },
      });
      return created;
    });

    res.status(201).json(shapeApplication({ ...application, listing: null }));
  }),
);

// One-click apply: copies every field from the listing and freezes a snapshot
// so later upstream edits can be detected and shown as a diff.
router.post(
  '/from-listing/:listingId',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = getAuth(req).userId;
    const listingId = Number(req.params.listingId);
    if (!Number.isInteger(listingId)) throw httpError(400, 'Invalid listing id');

    const listing = await prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw httpError(404, 'Listing not found');

    const existing = await prisma.application.findFirst({
      where: { userId, listingId },
      select: { id: true },
    });
    if (existing) {
      throw httpError(409, 'You have already added this listing to your tracker');
    }

    const status = STATUSES.includes(req.body?.status) ? req.body.status : 'Applied';
    const application = await prisma.$transaction(async (tx) => {
      const created = await tx.application.create({
        data: {
          ...listingToApplicationFields(listing),
          userId,
          listingId,
          status,
          dateApplied: new Date(),
          snapshot: snapshotOf(listing),
          snapshotHash: listing.contentHash,
        },
      });
      await tx.applicationEvent.create({
        data: {
          applicationId: created.id,
          userId,
          type: 'created',
          toStatus: status,
          detail: 'Imported from the listings feed',
        },
      });
      return created;
    });

    res.status(201).json(shapeApplication({ ...application, listing }));
  }),
);

router.patch(
  '/:id',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = getAuth(req).userId;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw httpError(400, 'Invalid application id');

    const current = await prisma.application.findFirst({ where: { id, userId } });
    if (!current) throw httpError(404, 'Application not found');

    const data = pickEditableFields(req.body ?? {});

    // The original client sent { newStatus }; accept both spellings.
    const requestedStatus = req.body?.status ?? req.body?.newStatus;
    let statusChanged = false;
    if (requestedStatus !== undefined) {
      if (!STATUSES.includes(requestedStatus)) {
        throw httpError(400, `Status must be one of: ${STATUSES.join(', ')}`);
      }
      if (requestedStatus !== current.status) {
        data.status = requestedStatus;
        statusChanged = true;
      }
    }

    if (Object.keys(data).length === 0) {
      return res.json(shapeApplication({ ...current, listing: null }));
    }

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.application.update({ where: { id }, data });
      if (statusChanged) {
        await tx.applicationEvent.create({
          data: {
            applicationId: id,
            userId,
            type: 'status',
            fromStatus: current.status,
            toStatus: data.status,
          },
        });
      }
      return next;
    });

    const listing = updated.listingId
      ? await prisma.listing.findUnique({ where: { id: updated.listingId }, ...LISTING_SELECT })
      : null;

    res.json(shapeApplication({ ...updated, listing }));
  }),
);

router.get(
  '/:id/upstream',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = getAuth(req).userId;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw httpError(400, 'Invalid application id');

    const application = await prisma.application.findFirst({
      where: { id, userId },
      include: { listing: true },
    });
    if (!application) throw httpError(404, 'Application not found');
    if (!application.listing) {
      return res.json({ hasUpstreamChange: false, changes: [], reason: 'not-linked' });
    }

    res.json({
      hasUpstreamChange: hasUpstreamChange(application),
      changedAt: application.listing.lastChangedAt,
      changes: diffSnapshot(application.snapshot, application.listing),
    });
  }),
);

// Pull the upstream edit into the user's record. This is the only path that
// mutates an imported application from the feed side.
router.post(
  '/:id/upstream/accept',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = getAuth(req).userId;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw httpError(400, 'Invalid application id');

    const application = await prisma.application.findFirst({
      where: { id, userId },
      include: { listing: true },
    });
    if (!application) throw httpError(404, 'Application not found');
    if (!application.listing) throw httpError(400, 'This application is not linked to a listing');

    const listing = application.listing;
    const changes = diffSnapshot(application.snapshot, listing);

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.application.update({
        where: { id },
        data: {
          ...listingToApplicationFields(listing),
          snapshot: snapshotOf(listing),
          snapshotHash: listing.contentHash,
          dismissedHash: null,
        },
      });
      await tx.applicationEvent.create({
        data: {
          applicationId: id,
          userId,
          type: 'upstream_accepted',
          detail:
            changes.length > 0
              ? `Pulled in upstream changes to ${changes.map((c) => c.label).join(', ')}`
              : 'Re-synced with the listing',
        },
      });
      return next;
    });

    res.json({ ...shapeApplication({ ...updated, listing }), appliedChanges: changes });
  }),
);

// Keep the record as-is but stop showing the badge for this exact revision.
// A later upstream edit produces a new hash and the badge returns.
router.post(
  '/:id/upstream/dismiss',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = getAuth(req).userId;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw httpError(400, 'Invalid application id');

    const application = await prisma.application.findFirst({
      where: { id, userId },
      include: { listing: true },
    });
    if (!application) throw httpError(404, 'Application not found');
    if (!application.listing) throw httpError(400, 'This application is not linked to a listing');

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.application.update({
        where: { id },
        data: { dismissedHash: application.listing.contentHash },
      });
      await tx.applicationEvent.create({
        data: {
          applicationId: id,
          userId,
          type: 'upstream_dismissed',
          detail: 'Kept your record and ignored the upstream edit',
        },
      });
      return next;
    });

    res.json(shapeApplication({ ...updated, listing: application.listing }));
  }),
);

router.delete(
  '/:id',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = getAuth(req).userId;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw httpError(400, 'Invalid application id');

    const removed = await prisma.application.deleteMany({ where: { id, userId } });
    if (removed.count === 0) throw httpError(404, 'Application not found');
    res.json({ id, deleted: true });
  }),
);

module.exports = { router, STATUSES };
