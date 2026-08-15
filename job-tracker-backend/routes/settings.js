const express = require('express');
const { getAuth } = require('@clerk/express');
const { requireUser, asyncHandler, httpError } = require('../middleware');
const { getStatus, saveApiKey, deleteApiKey } = require('../lib/credentials');
const { clearClientCache, MODEL } = require('../lib/matcher');

const router = express.Router();

router.get(
  '/api-key',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = getAuth(req).userId;
    res.json({ ...(await getStatus(userId)), model: MODEL });
  }),
);

router.put(
  '/api-key',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = getAuth(req).userId;
    const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';

    if (!apiKey) throw httpError(400, 'Paste your Anthropic API key first');
    if (!apiKey.startsWith('sk-ant-')) {
      throw httpError(400, 'That does not look like an Anthropic API key — they start with "sk-ant-"');
    }

    try {
      const status = await saveApiKey(userId, apiKey);
      // Drop any cached client built from a previously stored key.
      clearClientCache();
      res.json({ ...status, model: MODEL });
    } catch (error) {
      // 503 comes from the crypto layer when CREDENTIAL_SECRET is unset; let it
      // through with its own message rather than reporting a bad key.
      if (error.status === 503) throw error;
      if (error.status === 401 || error.status === 403) {
        throw httpError(400, 'Anthropic rejected that key. Check it was copied in full.');
      }
      throw httpError(400, `Could not verify that key: ${error.message}`);
    }
  }),
);

router.delete(
  '/api-key',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = getAuth(req).userId;
    const status = await deleteApiKey(userId);
    clearClientCache();
    res.json({ ...status, model: MODEL });
  }),
);

module.exports = { router };
