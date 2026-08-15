const prisma = require('../prisma');
const { encrypt, decrypt, preview, isConfigured } = require('./crypto');

const PROVIDER = 'anthropic';

/**
 * Resolves which Anthropic key a given user's work should run on.
 *
 * A user's own key always wins. The server-wide key is only a fallback, so a
 * deployment can either run on the operator's key or require each user to bring
 * their own simply by not setting ANTHROPIC_API_KEY.
 */
async function resolveApiKey(userId) {
  if (isConfigured()) {
    const record = await prisma.userCredential.findUnique({ where: { userId } });
    if (record) {
      try {
        return { key: decrypt(record), source: 'user', preview: record.preview };
      } catch (error) {
        // A rotated CREDENTIAL_SECRET makes stored ciphertext undecryptable.
        // Fall through to the server key rather than failing the whole run.
        console.error('[credentials] could not decrypt stored key:', error.message);
      }
    }
  }

  const serverKey = process.env.ANTHROPIC_API_KEY;
  if (serverKey) return { key: serverKey, source: 'server', preview: preview(serverKey) };

  return { key: null, source: 'none', preview: null };
}

async function getStatus(userId) {
  const record = isConfigured()
    ? await prisma.userCredential.findUnique({ where: { userId } })
    : null;
  const serverKeyPresent = Boolean(process.env.ANTHROPIC_API_KEY);

  return {
    // Whether *this user's* scoring can use Claude at all.
    aiEnabled: Boolean(record) || serverKeyPresent,
    source: record ? 'user' : serverKeyPresent ? 'server' : 'none',
    hasOwnKey: Boolean(record),
    preview: record?.preview ?? null,
    lastValidatedAt: record?.lastValidatedAt ?? null,
    lastValidationError: record?.lastValidationError ?? null,
    serverKeyAvailable: serverKeyPresent,
    storageReady: isConfigured(),
  };
}

/** Confirms the key authenticates before we store it. Costs no tokens. */
async function validateApiKey(apiKey) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey, maxRetries: 1 });
  await client.models.list({ limit: 1 });
}

async function saveApiKey(userId, apiKey) {
  await validateApiKey(apiKey);
  const encrypted = encrypt(apiKey);
  const data = {
    provider: PROVIDER,
    ...encrypted,
    preview: preview(apiKey),
    lastValidatedAt: new Date(),
    lastValidationError: null,
  };
  await prisma.userCredential.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });
  return getStatus(userId);
}

async function deleteApiKey(userId) {
  await prisma.userCredential.deleteMany({ where: { userId } });
  return getStatus(userId);
}

module.exports = { resolveApiKey, getStatus, saveApiKey, deleteApiKey, validateApiKey };
