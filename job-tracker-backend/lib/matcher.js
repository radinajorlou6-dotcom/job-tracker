const crypto = require('crypto');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
const EFFORT = process.env.ANTHROPIC_EFFORT || 'low';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

// Scoring many listings is a bounded judgement task, so a modest batch keeps
// each request small enough to stay well inside max_tokens.
const BATCH_SIZE = 12;

let cachedClient;
let cachedClientKey;

// Returns null when no API key is configured — callers fall back to the
// deterministic scorer so the feature still works without Claude.
function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (cachedClient && cachedClientKey === apiKey) return cachedClient;
  const Anthropic = require('@anthropic-ai/sdk');
  cachedClient = new Anthropic({ apiKey });
  cachedClientKey = apiKey;
  return cachedClient;
}

function aiAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const PREF_FIELDS = [
  'headline',
  'desiredRoles',
  'preferredLocations',
  'remotePreference',
  'terms',
  'degrees',
  'categories',
  'needsSponsorship',
  'excludedCompanies',
  'mustHaves',
  'dealBreakers',
  'values',
];

// Identifies a preference set. When this changes, existing scores are stale and
// the UI can offer a re-run without us deleting anything.
function prefsHash(prefs) {
  const canonical = {};
  for (const field of PREF_FIELDS) {
    const value = prefs?.[field];
    canonical[field] = Array.isArray(value) ? [...value].sort() : (value ?? null);
  }
  canonical.engine = aiAvailable() ? `claude:${MODEL}` : 'heuristic';
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 32);
}

function verdictFor(score) {
  if (score >= 80) return 'strong';
  if (score >= 65) return 'good';
  if (score >= 45) return 'stretch';
  return 'weak';
}

function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function lower(value) {
  return (value ?? '').toString().toLowerCase();
}

function anyMatch(haystackParts, needles) {
  const hay = haystackParts.filter(Boolean).map(lower).join(' | ');
  return needles.filter((needle) => needle && hay.includes(lower(needle)));
}

const REMOTE_HINTS = ['remote', 'anywhere', 'virtual', 'work from home'];

/**
 * Deterministic scorer. Used when no Anthropic key is configured, and as the
 * per-batch fallback whenever a Claude call fails or is refused, so a match run
 * always produces a complete result set.
 */
function heuristicScore(listing, prefs) {
  let score = 50;

  // Points are tracked alongside the text so the most decisive signals survive
  // the slice below. Without this, a hard blocker like a citizenship
  // requirement can be pushed out of the list by minor mismatches.
  const reasons = [];
  const concerns = [];
  const addReason = (weight, text) => reasons.push({ weight, text });
  const addConcern = (weight, text) => concerns.push({ weight, text });
  const rank = (list) =>
    [...list].sort((a, b) => b.weight - a.weight).map((entry) => entry.text);

  const roleText = [listing.role, listing.category].filter(Boolean).join(' ');
  const desiredRoles = prefs.desiredRoles ?? [];
  const roleHits = anyMatch([roleText], desiredRoles);
  if (roleHits.length > 0) {
    const points = Math.min(26, 14 + roleHits.length * 6);
    score += points;
    addReason(points, `Role matches your interest in ${roleHits.slice(0, 2).join(' / ')}`);
  } else if (desiredRoles.length > 0) {
    score -= 12;
    addConcern(12, 'Role title does not match any of your target roles');
  }

  const categories = prefs.categories ?? [];
  if (categories.length > 0 && listing.category) {
    if (anyMatch([listing.category], categories).length > 0) {
      score += 8;
      addReason(8, `In your preferred category (${listing.category})`);
    } else {
      score -= 8;
      addConcern(8, `Category is ${listing.category}, outside your preferred categories`);
    }
  }

  const locations = listing.locations ?? [];
  const locationText = locations.join(' ');
  const isRemote = REMOTE_HINTS.some((hint) => lower(locationText).includes(hint));
  const preferredLocations = prefs.preferredLocations ?? [];
  const locationHits = anyMatch(locations, preferredLocations);

  if (prefs.remotePreference === 'remote') {
    if (isRemote) {
      score += 16;
      addReason(16, 'Remote, which is what you asked for');
    } else {
      score -= 14;
      addConcern(14, 'On-site or hybrid, but you prefer remote');
    }
  } else if (prefs.remotePreference === 'onsite' && isRemote) {
    score -= 6;
    addConcern(6, 'Listed as remote, but you prefer on-site');
  } else if (isRemote) {
    score += 6;
    addReason(6, 'Remote-friendly');
  }

  if (locationHits.length > 0) {
    score += 14;
    addReason(14, `Located in ${locationHits.slice(0, 2).join(' / ')}`);
  } else if (preferredLocations.length > 0 && locations.length > 0 && !isRemote) {
    score -= 10;
    addConcern(10, `Located in ${locations.slice(0, 2).join(', ')}, outside your preferred areas`);
  }

  const termHits = anyMatch(listing.terms ?? [], prefs.terms ?? []);
  if (termHits.length > 0) {
    score += 10;
    addReason(10, `Runs during ${termHits.slice(0, 2).join(' / ')}`);
  } else if ((prefs.terms ?? []).length > 0 && (listing.terms ?? []).length > 0) {
    score -= 8;
    addConcern(8, `Term is ${(listing.terms ?? []).slice(0, 2).join(', ')}, not one you selected`);
  }

  const degreeHits = anyMatch(listing.degrees ?? [], prefs.degrees ?? []);
  if (degreeHits.length > 0) {
    score += 8;
    addReason(8, `Open to ${degreeHits.slice(0, 2).join(' / ')} candidates`);
  } else if ((prefs.degrees ?? []).length > 0 && (listing.degrees ?? []).length > 0) {
    score -= 12;
    addConcern(12, `Targets ${(listing.degrees ?? []).slice(0, 2).join(', ')} candidates`);
  }

  const sponsorship = lower(listing.sponsorship);
  if (prefs.needsSponsorship) {
    if (sponsorship.includes('does not offer sponsorship')) {
      score -= 40;
      addConcern(40, 'Employer does not offer visa sponsorship');
    } else if (sponsorship.includes('citizen')) {
      score -= 45;
      addConcern(45, 'Requires U.S. citizenship or clearance');
    } else if (sponsorship.includes('offers sponsorship')) {
      score += 14;
      addReason(14, 'Employer offers visa sponsorship');
    }
  }

  const excluded = anyMatch([listing.company], prefs.excludedCompanies ?? []);
  if (excluded.length > 0) {
    score -= 60;
    addConcern(60, `${listing.company} is on your excluded list`);
  }

  if (listing.active === false) {
    score -= 25;
    addConcern(25, 'Listing is marked inactive upstream');
  }

  if (listing.datePosted) {
    const ageDays = (Date.now() - new Date(listing.datePosted).getTime()) / 86400000;
    if (ageDays <= 7) {
      score += 8;
      addReason(8, 'Posted within the last week');
    } else if (ageDays <= 30) {
      score += 3;
    } else if (ageDays > 120) {
      score -= 10;
      addConcern(10, 'Posted more than four months ago');
    }
  }

  const finalScore = clamp(score);
  const rankedReasons = rank(reasons);
  const rankedConcerns = rank(concerns);
  const summary =
    rankedReasons.length > 0
      ? `${rankedReasons[0]}.${
          rankedConcerns.length > 0 ? ` Watch out: ${lower(rankedConcerns[0])}.` : ''
        }`
      : (rankedConcerns[0] ?? 'No strong signal either way from your saved preferences.');

  return {
    score: finalScore,
    verdict: verdictFor(finalScore),
    reasons: rankedReasons.slice(0, 4),
    concerns: rankedConcerns.slice(0, 4),
    summary,
    engine: 'heuristic',
    model: null,
  };
}

function describeCandidate(prefs) {
  const lines = [];
  const push = (label, value) => {
    if (Array.isArray(value) ? value.length > 0 : Boolean(value)) {
      lines.push(`${label}: ${Array.isArray(value) ? value.join(', ') : value}`);
    }
  };
  push('About', prefs.headline);
  push('Target roles', prefs.desiredRoles);
  push('Preferred locations', prefs.preferredLocations);
  push('Work arrangement preference', prefs.remotePreference);
  push('Terms of interest', prefs.terms);
  push('Degree level', prefs.degrees);
  push('Preferred categories', prefs.categories);
  push('Requires visa sponsorship', prefs.needsSponsorship ? 'yes' : 'no');
  push('Companies to avoid', prefs.excludedCompanies);
  push('Must haves', prefs.mustHaves);
  push('Deal breakers', prefs.dealBreakers);
  push('Values / what matters to them', prefs.values);
  return lines.length > 0 ? lines.join('\n') : 'No preferences recorded yet.';
}

function listingForPrompt(listing) {
  return {
    id: listing.id,
    company: listing.company,
    role: listing.role,
    category: listing.category,
    locations: listing.locations ?? [],
    terms: listing.terms ?? [],
    degrees: listing.degrees ?? [],
    sponsorship: listing.sponsorship,
    active: listing.active,
    postedDaysAgo: listing.datePosted
      ? Math.round((Date.now() - new Date(listing.datePosted).getTime()) / 86400000)
      : null,
  };
}

const SYSTEM_PROMPT = `You score job listings against one candidate's stated preferences so they can skip the ones not worth applying to.

For each listing return:
- score: 0-100. 80+ means apply now, 65-79 worth applying, 45-64 a stretch worth considering, below 45 skip.
- verdict: "strong" | "good" | "stretch" | "weak", consistent with the score bands above.
- reasons: up to 3 short phrases naming concrete evidence for the score. Cite the listing's own fields (role, location, term, degree, sponsorship), never generic praise.
- concerns: up to 3 short phrases on what would make this a bad fit. Empty array if there is genuinely nothing.
- summary: one sentence, under 25 words, written to the candidate.

Weigh hard blockers heaviest: a sponsorship or citizenship requirement the candidate cannot meet, a degree level they do not hold, or a company they listed as excluded should all land below 30 regardless of how appealing the role is. An inactive listing is not worth applying to. When a preference is simply unstated, treat it as neutral rather than as a mismatch. Score each listing on its own merits, not relative to the others in the batch.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    matches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          score: { type: 'integer' },
          verdict: { type: 'string', enum: ['strong', 'good', 'stretch', 'weak'] },
          reasons: { type: 'array', items: { type: 'string' } },
          concerns: { type: 'array', items: { type: 'string' } },
          summary: { type: 'string' },
        },
        required: ['id', 'score', 'verdict', 'reasons', 'concerns', 'summary'],
        additionalProperties: false,
      },
    },
  },
  required: ['matches'],
  additionalProperties: false,
};

function extractJson(message) {
  const textBlock = message.content.find((block) => block.type === 'text');
  if (!textBlock) throw new Error('Model returned no text block');
  return JSON.parse(textBlock.text);
}

// Claude Opus 5 can decline a request outright; when it does we fall back to the
// deterministic scorer rather than dropping the batch.
let fallbackBetaSupported = true;

async function callClaude(client, prefs, listings) {
  const request = {
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    output_config: {
      effort: EFFORT,
      format: { type: 'json_schema', schema: RESPONSE_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: `Candidate preferences:\n${describeCandidate(prefs)}\n\nListings to score:\n${JSON.stringify(
          listings.map(listingForPrompt),
          null,
          1,
        )}`,
      },
    ],
  };

  if (fallbackBetaSupported) {
    try {
      return await client.beta.messages.create({
        ...request,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
      });
    } catch (error) {
      // If this deployment doesn't have the server-side fallback beta, stop
      // asking for it and use the standard endpoint from here on.
      if (error?.status === 400 || error?.status === 404) {
        fallbackBetaSupported = false;
        console.warn('[matcher] server-side fallbacks unavailable, using standard endpoint');
      } else {
        throw error;
      }
    }
  }

  return client.messages.create(request);
}

async function scoreBatchWithClaude(client, prefs, listings) {
  const message = await callClaude(client, prefs, listings);

  if (message.stop_reason === 'refusal') {
    const category = message.stop_details?.category ?? 'unspecified';
    throw new Error(`Model declined to score this batch (${category})`);
  }

  const parsed = extractJson(message);
  const byId = new Map();
  for (const match of parsed.matches ?? []) {
    byId.set(match.id, {
      score: clamp(match.score),
      verdict: match.verdict || verdictFor(clamp(match.score)),
      reasons: (match.reasons ?? []).slice(0, 4),
      concerns: (match.concerns ?? []).slice(0, 4),
      summary: match.summary ?? '',
      engine: 'claude',
      model: message.model ?? MODEL,
    });
  }

  // Any listing the model skipped still gets a score, from the heuristic.
  return listings.map((listing) => byId.get(listing.id) ?? heuristicScore(listing, prefs));
}

/**
 * Scores listings, in batches, using Claude when configured and the
 * deterministic scorer otherwise. Never throws: a failed batch degrades to
 * heuristic scores and surfaces the reason through `onProgress`.
 */
async function scoreListings(listings, prefs, { onProgress } = {}) {
  const client = getClient();
  const results = [];
  let degraded = null;

  for (let i = 0; i < listings.length; i += BATCH_SIZE) {
    const batch = listings.slice(i, i + BATCH_SIZE);
    let scored;

    if (client) {
      try {
        scored = await scoreBatchWithClaude(client, prefs, batch);
      } catch (error) {
        degraded = error.message;
        console.error('[matcher] batch failed, falling back to heuristic:', error.message);
        scored = batch.map((listing) => heuristicScore(listing, prefs));
      }
    } else {
      scored = batch.map((listing) => heuristicScore(listing, prefs));
    }

    batch.forEach((listing, index) => {
      results.push({ listingId: listing.id, ...scored[index] });
    });

    if (onProgress) onProgress({ done: results.length, total: listings.length, degraded });
  }

  return { results, degraded };
}

module.exports = {
  MODEL,
  BATCH_SIZE,
  aiAvailable,
  prefsHash,
  heuristicScore,
  scoreListings,
  verdictFor,
};
