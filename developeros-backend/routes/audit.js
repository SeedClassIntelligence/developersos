const express = require('express');
const router = express.Router();
const auditRepo = require('../db/repositories/audit.repo');
const signing = require('../db/audit-signing');
const { requirePermission } = require('../middleware/auth');

router.get('/', requirePermission('audit:read'), async (req, res, next) => {
  try {
    res.json(await auditRepo.list(req.organizationId, req.query.limit, req.query.before, req.query.beforeSeq));
  } catch (err) { next(err); }
});

// Cryptographic verification of the active organization's chain.
router.get('/verify', requirePermission('audit:read'), async (req, res, next) => {
  try {
    res.json(await auditRepo.verify(req.organizationId));
  } catch (err) { next(err); }
});

// Same verification, additionally checking externally retained signed
// receipts ({ receipts: [...] }). This is how a tenant or auditor proves that
// positions they were once given have not since been removed.
router.post('/verify', requirePermission('audit:read'), async (req, res, next) => {
  try {
    const receipts = req.body && req.body.receipts;
    if (receipts !== undefined && (!Array.isArray(receipts) || receipts.some(r => !r || typeof r !== 'object'))) {
      return res.status(400).json({ error: 'receipts must be an array of checkpoint receipts' });
    }
    res.json(await auditRepo.verify(req.organizationId, { receipts }));
  } catch (err) { next(err); }
});

// Issues a signed checkpoint receipt for the current chain head.
router.post('/checkpoints', requirePermission('audit:read'), async (req, res, next) => {
  try {
    const receipt = await auditRepo.issueCheckpoint(req.organizationId);
    if (!receipt) return res.status(409).json({ error: 'Organization ledger has no events to checkpoint' });
    res.status(201).json(receipt);
  } catch (err) { next(err); }
});

router.get('/checkpoints', requirePermission('audit:read'), async (req, res, next) => {
  try {
    res.json(await auditRepo.listCheckpoints(req.organizationId));
  } catch (err) { next(err); }
});

router.get('/signing-key', requirePermission('audit:read'), (req, res) => {
  res.json(signing.publicKeyInfo());
});

module.exports = router;
