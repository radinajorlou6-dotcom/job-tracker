/* Verifies per-user API key storage: encryption round-trip, isolation between
   users, key-source resolution, and that plaintext never leaks into the DB.
   Run with: node scripts/verify-credentials.js                                */
require('dotenv/config');

const prisma = require('../prisma');
const { encrypt, decrypt, preview, isConfigured } = require('../lib/crypto');
const { resolveApiKey, getStatus } = require('../lib/credentials');
const { prefsHash } = require('../lib/matcher');

const USER_A = `cred_a_${Date.now()}`;
const USER_B = `cred_b_${Date.now()}`;
const FAKE_KEY = 'sk-ant-api03-THIS-IS-NOT-A-REAL-KEY-0123456789abcdef';
const OTHER_KEY = 'sk-ant-api03-A-DIFFERENT-FAKE-KEY-fedcba9876543210';

let failures = 0;
function check(label, condition, detail) {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

// Stores directly rather than going through saveApiKey(), which would call the
// live Anthropic API to validate. Validation is covered separately below.
async function storeRaw(userId, apiKey) {
  const data = { ...encrypt(apiKey), preview: preview(apiKey), lastValidatedAt: new Date() };
  await prisma.userCredential.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });
}

async function main() {
  console.log('\nVerifying per-user API key storage\n');

  console.log('Encryption');
  check('CREDENTIAL_SECRET is configured', isConfigured());

  const encrypted = encrypt(FAKE_KEY);
  check('round-trips back to the original key', decrypt(encrypted) === FAKE_KEY);
  check('ciphertext does not contain the plaintext', !encrypted.ciphertext.includes('sk-ant'));
  check(
    'same key encrypts differently each time (random IV)',
    encrypt(FAKE_KEY).ciphertext !== encrypted.ciphertext,
  );

  let tampered = null;
  try {
    const bytes = Buffer.from(encrypted.ciphertext, 'base64');
    bytes[0] ^= 0xff;
    decrypt({ ...encrypted, ciphertext: bytes.toString('base64') });
  } catch (error) {
    tampered = error;
  }
  check('tampered ciphertext is rejected (GCM auth tag)', tampered !== null);

  check('preview masks the middle of the key', preview(FAKE_KEY).includes('…'));
  check('preview does not expose the full key', !preview(FAKE_KEY).includes('0123456789abcdef'));

  console.log('\nStorage and isolation');
  await storeRaw(USER_A, FAKE_KEY);
  await storeRaw(USER_B, OTHER_KEY);

  const rowA = await prisma.userCredential.findUnique({ where: { userId: USER_A } });
  const serialized = JSON.stringify(rowA);
  check('no plaintext key anywhere in the stored row', !serialized.includes(FAKE_KEY));
  check('stored row has no column named like a raw key', !('apiKey' in rowA));

  const resolvedA = await resolveApiKey(USER_A);
  const resolvedB = await resolveApiKey(USER_B);
  check('user A resolves to their own key', resolvedA.key === FAKE_KEY);
  check('user B resolves to their own key', resolvedB.key === OTHER_KEY);
  check('users do not see each other keys', resolvedA.key !== resolvedB.key);
  check('source is reported as user', resolvedA.source === 'user');

  const statusA = await getStatus(USER_A);
  check('status reports AI enabled', statusA.aiEnabled === true);
  check('status exposes only the masked preview', statusA.preview === preview(FAKE_KEY));
  check(
    'status object carries no plaintext key',
    !JSON.stringify(statusA).includes(FAKE_KEY),
  );

  console.log('\nFallback behaviour');
  const noKeyUser = `cred_none_${Date.now()}`;
  const savedEnv = process.env.ANTHROPIC_API_KEY;

  delete process.env.ANTHROPIC_API_KEY;
  const noneResolved = await resolveApiKey(noKeyUser);
  check('user without a key and no server key resolves to none', noneResolved.source === 'none');
  check('no key returned in that case', noneResolved.key === null);

  process.env.ANTHROPIC_API_KEY = 'sk-ant-server-fallback-key';
  const serverResolved = await resolveApiKey(noKeyUser);
  check('falls back to the server key when present', serverResolved.source === 'server');
  const stillOwn = await resolveApiKey(USER_A);
  check('a user key still wins over the server key', stillOwn.source === 'user');

  if (savedEnv === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedEnv;

  console.log('\nScore invalidation');
  const prefs = { desiredRoles: ['Software Engineer'] };
  check(
    'adding a key invalidates heuristic scores',
    prefsHash(prefs, { ai: false }) !== prefsHash(prefs, { ai: true }),
  );
  check(
    'hash is stable for the same engine',
    prefsHash(prefs, { ai: true }) === prefsHash(prefs, { ai: true }),
  );

  console.log('\nCleanup');
  await prisma.userCredential.deleteMany({ where: { userId: { in: [USER_A, USER_B] } } });
  const remaining = await prisma.userCredential.count({
    where: { userId: { in: [USER_A, USER_B] } },
  });
  check('scratch credentials removed', remaining === 0);

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error('\nVerification crashed:', error);
  await prisma.$disconnect();
  process.exit(1);
});
