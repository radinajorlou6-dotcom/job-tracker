/* Exercises the real data paths against the live database with a scratch user,
   then removes everything it created. Run with: node scripts/verify.js        */
require('dotenv/config');

const prisma = require('../prisma');
const {
  snapshotOf,
  diffSnapshot,
  contentHash,
  listingToApplicationFields,
} = require('../lib/listings');
const { heuristicScore, prefsHash, scoreListings } = require('../lib/matcher');

const USER = `verify_user_${Date.now()}`;
let failures = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  console.log(`\nVerifying with scratch user ${USER}\n`);

  // --- Preferences -------------------------------------------------------
  console.log('Preferences');
  const prefs = await prisma.userPreferences.create({
    data: {
      userId: USER,
      headline: 'CS student focused on backend systems',
      desiredRoles: ['Software Engineer', 'Backend'],
      preferredLocations: ['New York, NY', 'Remote'],
      remotePreference: 'any',
      terms: ['Summer 2027'],
      degrees: ['Bachelors'],
      categories: ['Software Engineering'],
      needsSponsorship: true,
      excludedCompanies: ['ExcludedCorp'],
      mustHaves: 'Pays hourly',
      dealBreakers: 'No defense work',
      values: 'Mentorship and shipping to real users',
    },
  });
  check('preferences persist', prefs.userId === USER);

  const hash = prefsHash(prefs);
  check('prefsHash is stable', prefsHash(prefs) === hash);
  check(
    'prefsHash changes when preferences change',
    prefsHash({ ...prefs, needsSponsorship: false }) !== hash,
  );

  // --- Heuristic scoring -------------------------------------------------
  console.log('\nHeuristic scoring');
  const good = heuristicScore(
    {
      role: 'Software Engineer Intern',
      company: 'GoodCo',
      category: 'Software Engineering',
      locations: ['New York, NY'],
      terms: ['Summer 2027'],
      degrees: [],
      sponsorship: 'Offers Sponsorship',
      active: true,
      datePosted: new Date(),
    },
    prefs,
  );
  const bad = heuristicScore(
    {
      role: 'Mechanical Engineering Intern',
      company: 'ExcludedCorp',
      category: 'Hardware',
      locations: ['Remote Location, TX'],
      terms: ['Fall 2025'],
      degrees: ['PhD'],
      sponsorship: 'U.S. Citizenship is required',
      active: false,
      datePosted: new Date(Date.now() - 300 * 86400000),
    },
    prefs,
  );
  check(`aligned listing scores high (${good.score})`, good.score >= 80);
  check(`blocked listing scores low (${bad.score})`, bad.score <= 20);
  check('scores stay within 0-100', good.score <= 100 && bad.score >= 0);
  check('reasons are populated', good.reasons.length > 0);
  check('citizenship requirement is flagged', bad.concerns.some((c) => /citizenship/i.test(c)));
  check('excluded company is flagged', bad.concerns.some((c) => /excluded/i.test(c)));

  // --- Batch scoring + persistence --------------------------------------
  console.log('\nMatch persistence');
  const sample = await prisma.listing.findMany({
    where: { active: true, isVisible: true },
    take: 8,
    orderBy: { datePosted: 'desc' },
  });
  check('found active listings to score', sample.length > 0);

  const { results } = await scoreListings(sample, prefs);
  check('every listing got a score', results.length === sample.length);

  for (const result of results) {
    await prisma.listingMatch.upsert({
      where: { userId_listingId: { userId: USER, listingId: result.listingId } },
      update: { ...result, listingId: undefined, prefsHash: hash },
      create: { userId: USER, ...result, prefsHash: hash },
    });
  }
  const storedMatches = await prisma.listingMatch.count({ where: { userId: USER } });
  check(`matches persisted (${storedMatches})`, storedMatches === sample.length);

  // Sorting the feed by score is the query the Listings tab actually runs.
  const byScore = await prisma.listingMatch.findMany({
    where: { userId: USER, listing: { active: true, isVisible: true } },
    orderBy: [{ score: 'desc' }, { listingId: 'asc' }],
    include: { listing: true },
    take: 5,
  });
  check(
    'match-sorted feed query returns descending scores',
    byScore.every((m, i) => i === 0 || byScore[i - 1].score >= m.score),
  );

  // --- One-click apply ---------------------------------------------------
  console.log('\nOne-click apply');
  const target = sample[0];
  const application = await prisma.application.create({
    data: {
      ...listingToApplicationFields(target),
      userId: USER,
      listingId: target.id,
      status: 'Applied',
      dateApplied: new Date(),
      snapshot: snapshotOf(target),
      snapshotHash: target.contentHash,
    },
  });
  await prisma.applicationEvent.create({
    data: { applicationId: application.id, userId: USER, type: 'created', toStatus: 'Applied' },
  });

  check('application copies the listing company', application.company === target.company);
  check('application copies the listing role', application.role === target.role);
  check('application copies the apply link', application.url === target.url);
  check('snapshot hash recorded', Boolean(application.snapshotHash));

  let duplicate = null;
  try {
    await prisma.application.create({
      data: { userId: USER, listingId: target.id, status: 'Applied' },
    });
  } catch (error) {
    duplicate = error;
  }
  check('applying twice to one listing is rejected', duplicate !== null);

  // --- Change detection --------------------------------------------------
  console.log('\nChange detection');
  const before = await prisma.application.findUnique({
    where: { id: application.id },
    include: { listing: true },
  });
  check(
    'no change reported before the listing moves',
    before.listing.contentHash === before.snapshotHash &&
      diffSnapshot(before.snapshot, before.listing).length === 0,
  );

  // Simulate an upstream edit the way the importer would apply one.
  const editedLocations = [...(target.locations ?? []), 'Austin, TX'];
  const editedData = { ...target, role: `${target.role} (Updated)`, locations: editedLocations };
  const newHash = contentHash(editedData);
  await prisma.listing.update({
    where: { id: target.id },
    data: {
      role: editedData.role,
      locations: editedLocations,
      contentHash: newHash,
      lastChangedAt: new Date(),
    },
  });

  const after = await prisma.application.findUnique({
    where: { id: application.id },
    include: { listing: true },
  });
  const changes = diffSnapshot(after.snapshot, after.listing);
  check('upstream edit produces a new content hash', after.listing.contentHash !== after.snapshotHash);
  check(`diff reports the changed fields (${changes.map((c) => c.field).join(', ')})`, changes.length === 2);
  check('role change detected', changes.some((c) => c.field === 'role'));
  check('locations change detected', changes.some((c) => c.field === 'locations'));
  check(
    'the stored application itself is unchanged',
    after.role === target.role && !after.role.includes('(Updated)'),
  );

  // Dismiss keeps the record but silences this revision.
  await prisma.application.update({
    where: { id: application.id },
    data: { dismissedHash: after.listing.contentHash },
  });
  const dismissed = await prisma.application.findUnique({
    where: { id: application.id },
    include: { listing: true },
  });
  check(
    'dismissing silences the badge for this revision',
    dismissed.dismissedHash === dismissed.listing.contentHash,
  );

  // Accepting pulls the change in and re-freezes the snapshot.
  await prisma.application.update({
    where: { id: application.id },
    data: {
      ...listingToApplicationFields(dismissed.listing),
      snapshot: snapshotOf(dismissed.listing),
      snapshotHash: dismissed.listing.contentHash,
      dismissedHash: null,
    },
  });
  const accepted = await prisma.application.findUnique({
    where: { id: application.id },
    include: { listing: true },
  });
  check('accepting copies the new role across', accepted.role.includes('(Updated)'));
  check(
    'accepting clears the pending diff',
    diffSnapshot(accepted.snapshot, accepted.listing).length === 0,
  );

  // --- Status history / analytics ---------------------------------------
  console.log('\nStatus history and analytics');
  await prisma.application.update({
    where: { id: application.id },
    data: { status: 'Interviewing' },
  });
  await prisma.applicationEvent.create({
    data: {
      applicationId: application.id,
      userId: USER,
      type: 'status',
      fromStatus: 'Applied',
      toStatus: 'Interviewing',
    },
  });

  const events = await prisma.applicationEvent.findMany({ where: { userId: USER } });
  check(`event history recorded (${events.length} events)`, events.length === 2);

  const apps = await prisma.application.findMany({ where: { userId: USER } });
  const responded = apps.filter((a) => a.status !== 'Applied').length;
  check('response rate math works', apps.length === 1 && responded === 1);

  // --- Cleanup -----------------------------------------------------------
  console.log('\nCleanup');
  await prisma.listing.update({
    where: { id: target.id },
    data: {
      role: target.role,
      locations: target.locations,
      contentHash: target.contentHash,
      lastChangedAt: target.lastChangedAt,
    },
  });
  await prisma.applicationEvent.deleteMany({ where: { userId: USER } });
  await prisma.application.deleteMany({ where: { userId: USER } });
  await prisma.listingMatch.deleteMany({ where: { userId: USER } });
  await prisma.userPreferences.deleteMany({ where: { userId: USER } });

  const leftovers =
    (await prisma.application.count({ where: { userId: USER } })) +
    (await prisma.listingMatch.count({ where: { userId: USER } })) +
    (await prisma.userPreferences.count({ where: { userId: USER } }));
  check('scratch data removed', leftovers === 0);
  const restored = await prisma.listing.findUnique({ where: { id: target.id } });
  check('listing restored to its original state', restored.contentHash === target.contentHash);

  console.log(
    failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`,
  );
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error('\nVerification crashed:', error);
  await prisma.$disconnect();
  process.exit(1);
});
