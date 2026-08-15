const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce, the recommended size for GCM

/**
 * Derives the 32-byte master key from CREDENTIAL_SECRET.
 *
 * Throws when the secret is missing or too weak. Callers must let that
 * propagate: without a key we refuse to store anything rather than falling back
 * to plaintext, so a misconfigured deployment fails loudly instead of quietly
 * saving user API keys in the clear.
 */
function masterKey() {
  const secret = process.env.CREDENTIAL_SECRET;
  if (!secret || secret.length < 32) {
    const error = new Error(
      'CREDENTIAL_SECRET is missing or too short (needs at least 32 characters). ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
    error.status = 503;
    error.expose = true;
    throw error;
  }
  // Hash rather than slice, so any secret length maps to a full 32-byte key.
  return crypto.createHash('sha256').update(secret).digest();
}

function isConfigured() {
  const secret = process.env.CREDENTIAL_SECRET;
  return Boolean(secret && secret.length >= 32);
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

function decrypt({ ciphertext, iv, authTag }) {
  const decipher = crypto.createDecipheriv(ALGORITHM, masterKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Masked form safe to send to the browser and to render in the UI. */
function preview(apiKey) {
  if (apiKey.length <= 14) return `${apiKey.slice(0, 4)}…`;
  return `${apiKey.slice(0, 10)}…${apiKey.slice(-4)}`;
}

module.exports = { encrypt, decrypt, preview, isConfigured };
