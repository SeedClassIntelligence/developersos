// ═══════════════════════════════════════════════
// routes/messages.js
// Backed by durable PostgreSQL channels & messages tables
// ═══════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const messagesRepo = require('../db/repositories/messages.repo');
const { requirePermission, authorizeResource, authorizeProjectParent } = require('../middleware/auth');
const v = require('../middleware/execution-validation');

// GET channels
router.get('/channels', requirePermission('channels:read'), async (req, res, next) => {
  try {
    const channels = await messagesRepo.getChannels(req.query.projectId, req.organizationId);
    res.json(channels);
  } catch (err) {
    next(err);
  }
});

// GET messages for a channel
router.get('/channels/:channelId/messages', requirePermission('messages:read'), authorizeResource('channel', req => req.params.channelId), async (req, res, next) => {
  try {
    const msgs = await messagesRepo.getMessages(req.params.channelId);
    res.json(msgs);
  } catch (err) {
    next(err);
  }
});

// POST a message
router.post('/channels/:channelId/messages', requirePermission('messages:send'), authorizeResource('channel', req => req.params.channelId), v.validateMessage, async (req, res, next) => {
  try {
    // The sender is the authenticated member; display fields are never taken from the request.
    const msg = await messagesRepo.sendMessage(req.params.channelId, {
      text: req.body.text,
      sender: { userId: req.user.id, name: req.user.name, roleName: req.authorization.roleName },
    });
    res.status(201).json(msg);
  } catch (err) {
    next(err);
  }
});

// POST create channel
router.post('/channels', requirePermission('messages:send'), authorizeProjectParent, v.validateChannel, async (req, res, next) => {
  try {
    const channel = await messagesRepo.createChannel(req.body);
    res.status(201).json(channel);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
