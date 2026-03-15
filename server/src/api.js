/**
 * REST API routes.
 */

import { Router } from 'express';
import { authMiddleware } from './auth.js';
import { registry } from './connection-registry.js';
import { sendCommand } from './ws-handler.js';

export const router = Router();

// Health check (no auth required)
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    browsers: registry.list().length,
    uptime: process.uptime(),
  });
});

// List connected browsers
router.get('/browsers', authMiddleware, (req, res) => {
  res.json(registry.list());
});

// Send command to a browser
router.post('/browsers/:browserId/command', authMiddleware, async (req, res) => {
  const { browserId } = req.params;
  const { action, params } = req.body;

  if (!action) {
    return res.status(400).json({ error: 'Missing action' });
  }

  if (!registry.isConnected(browserId)) {
    return res.status(404).json({ error: `Browser ${browserId} not connected` });
  }

  try {
    const result = await sendCommand(browserId, action, params || {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
