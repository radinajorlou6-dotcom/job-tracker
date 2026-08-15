const crypto = require('crypto');

// External feeds we import from. `key` is stored on Listing.feed and is part of
// the natural key, so ids only have to be unique within a single repo.
const FEEDS = [
  {
    key: 'summer2027',
    label: 'Summer 2027 Internships',
    kind: 'internship',
    url: 'https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json',
  },
  {
    key: 'summer2026',
    label: 'Summer 2026 Internships',
    kind: 'internship',
    url: 'https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json',
  },
  {
    key: 'newgrad',
    label: 'New Grad Positions',
    kind: 'newgrad',
    url: 'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json',
  },
];

const FEED_KEYS = FEEDS.map((f) => f.key);

// Only fields a user would actually notice a change in. Timestamps are
// deliberately excluded so a no-op re-publish upstream doesn't look like an edit.
const TRACKED_FIELDS = [
  'company',
  'role',
  'url',
  'locations',
  'terms',
  'degrees',
  'sponsorship',
  'category',
  'companyUrl',
  'active',
  'isVisible',
];

const FIELD_LABELS = {
  company: 'Company',
  role: 'Role',
  url: 'Application link',
  locations: 'Locations',
  terms: 'Terms',
  degrees: 'Degrees',
  sponsorship: 'Sponsorship',
  category: 'Category',
  companyUrl: 'Company site',
  active: 'Still active',
  isVisible: 'Visible upstream',
};

function toDate(seconds) {
  if (!seconds && seconds !== 0) return null;
  const ms = Number(seconds) * 1000;
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toArray(value) {
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string' && v.trim() !== '');
  if (typeof value === 'string' && value.trim() !== '') return [value];
  return [];
}

// Map one raw SimplifyJobs record onto our Listing shape.
function normalizeListing(raw, feedKey) {
  return {
    feed: feedKey,
    source: raw.source ?? null,
    category: raw.category ?? null,
    company: raw.company_name ?? null,
    role: raw.title ?? null,
    active: typeof raw.active === 'boolean' ? raw.active : null,
    terms: toArray(raw.terms),
    dateUpdated: toDate(raw.date_updated),
    datePosted: toDate(raw.date_posted),
    url: raw.url ?? null,
    locations: toArray(raw.locations),
    companyUrl: raw.company_url ?? null,
    isVisible: raw.is_visible !== false,
    sponsorship: raw.sponsorship ?? null,
    degrees: toArray(raw.degrees),
  };
}

// Stable hash over TRACKED_FIELDS. Arrays are sorted so a reordering upstream
// isn't reported to the user as a change.
function contentHash(listing) {
  const canonical = {};
  for (const field of TRACKED_FIELDS) {
    const value = listing[field];
    canonical[field] = Array.isArray(value) ? [...value].sort() : (value ?? null);
  }
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

// The fields an Application copies from a Listing, so imported and hand-added
// entries carry exactly the same information.
function listingToApplicationFields(listing) {
  return {
    source: listing.source,
    sourceId: listing.sourceId,
    company: listing.company,
    role: listing.role,
    category: listing.category,
    terms: listing.terms ?? [],
    datePosted: listing.datePosted,
    url: listing.url,
    locations: listing.locations ?? [],
    companyUrl: listing.companyUrl,
    sponsorship: listing.sponsorship,
    degrees: listing.degrees ?? [],
  };
}

// A frozen copy of the listing at apply time, used as the left side of any diff.
function snapshotOf(listing) {
  const snapshot = {};
  for (const field of TRACKED_FIELDS) {
    const value = listing[field];
    snapshot[field] = Array.isArray(value) ? [...value] : (value ?? null);
  }
  snapshot.capturedAt = new Date().toISOString();
  return snapshot;
}

function sameValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    const left = [...(a ?? [])].sort();
    const right = [...(b ?? [])].sort();
    return left.length === right.length && left.every((v, i) => v === right[i]);
  }
  return (a ?? null) === (b ?? null);
}

// Field-by-field diff between the stored snapshot and the current listing.
function diffSnapshot(snapshot, listing) {
  if (!snapshot) return [];
  const changes = [];
  for (const field of TRACKED_FIELDS) {
    const before = snapshot[field] ?? null;
    const after = listing[field] ?? null;
    if (!sameValue(before, after)) {
      changes.push({ field, label: FIELD_LABELS[field] ?? field, before, after });
    }
  }
  return changes;
}

module.exports = {
  FEEDS,
  FEED_KEYS,
  TRACKED_FIELDS,
  FIELD_LABELS,
  normalizeListing,
  contentHash,
  listingToApplicationFields,
  snapshotOf,
  diffSnapshot,
};
