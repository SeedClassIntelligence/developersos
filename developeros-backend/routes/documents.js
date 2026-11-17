// ═══════════════════════════════════════════════
// routes/documents.js — project document register and file storage
//   GET    /api/documents?projectId=         documents:read
//   POST   /api/documents                    documents:create  register entry without a file
//   POST   /api/documents/upload?projectId=&name=&category=   documents:create
//          raw request body = the file; Content-Type = its type (allowlisted, signature-checked)
//   GET    /api/documents/:id/download       documents:read    always an attachment, never rendered inline
//   DELETE /api/documents/:id                documents:delete  removes the entry and its file
// ═══════════════════════════════════════════════

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const documentsRepo = require('../db/repositories/documents.repo');
const storage = require('../services/storage');
const { requirePermission, authorizeResource, authorizeProjectParent } = require('../middleware/auth');
const { stripIds } = require('../middleware/execution-validation');

const CATEGORIES = ['plans', 'contracts', 'permits', 'reports', 'mous', 'financial', 'other'];
const ICONS = { plans: '📐', contracts: '📝', permits: '🏛️', reports: '📊', mous: '🤝', financial: '💰', other: '📄' };

router.get('/', requirePermission('documents:read'), async (req, res, next) => {
  try {
    const docs = await documentsRepo.getAll({
      projectId: req.query.projectId,
      category: req.query.category,
      organizationId: req.organizationId,
    });
    res.json(docs);
  } catch (err) {
    next(err);
  }
});

// Register entry (no file). The uploader is the authenticated member.
router.post('/', requirePermission('documents:create'), authorizeProjectParent, async (req, res, next) => {
  try {
    const b = stripIds(req.body || {});
    if (typeof b.name !== 'string' || !b.name.trim()) return res.status(400).json({ error: 'name is required' });
    const d = await documentsRepo.create({ ...b, uploadedBy: req.user.name });
    res.status(201).json(d);
  } catch (err) {
    next(err);
  }
});

router.post('/upload', requirePermission('documents:create'),
  authorizeResource('project', req => req.query.projectId), async (req, res, next) => {
    try {
      const name = String(req.query.name || '').trim();
      const category = String(req.query.category || 'other');
      const contentType = String(req.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!name || name.length > 255) return res.status(400).json({ error: 'name is required (up to 255 characters)' });
      if (!CATEGORIES.includes(category)) return res.status(400).json({ error: `category must be one of ${CATEGORIES.join(', ')}` });
      const type = storage.TYPES[contentType];
      if (!type) return res.status(415).json({ error: 'This file type is not accepted. Use PDF, images (PNG/JPEG), Office documents, DWG, CSV or text.' });
      const declared = Number(req.get('content-length'));
      if (declared > storage.maxBytes()) {
        return res.status(413).json({ error: `File exceeds the ${Math.round(storage.maxBytes() / 1048576)} MB limit` });
      }
      const id = 'd' + crypto.randomUUID().replace(/-/g, '');
      const key = storage.keyFor(req.organizationId, req.query.projectId, id);
      let file;
      try {
        file = await storage.put(key, req, contentType);
      } catch (err) {
        if (err instanceof storage.StorageError) return res.status(err.status).json({ error: err.message });
        throw err;
      }
      try {
        const doc = await documentsRepo.createWithFile({
          id, projectId: req.query.projectId, name, category, icon: ICONS[category],
          typeLabel: type.label, storageKey: key,
          originalFilename: String(req.query.filename || name).slice(0, 255),
          contentType, size: file.size, sha256: file.sha256,
          uploadedByName: req.user.name, uploadedByUserId: req.user.id,
        });
        res.status(201).json(doc);
      } catch (err) {
        await storage.remove(key).catch(() => {});
        throw err;
      }
    } catch (err) {
      next(err);
    }
  });

router.get('/:id/download', requirePermission('documents:read'), authorizeResource('document'), async (req, res, next) => {
  try {
    const row = await documentsRepo.getRow(req.params.id);
    if (!row || !row.storage_key) return res.status(404).json({ error: 'This document has no stored file' });
    const stream = storage.open(row.storage_key);
    stream.on('error', err => {
      if (err.code === 'ENOENT') return res.headersSent ? res.end() : res.status(404).json({ error: 'Stored file is missing' });
      return next(err);
    });
    stream.once('open', () => {
      const filename = (row.original_filename || row.name).replace(/[\r\n"]/g, '');
      res.set({
        'Content-Type': row.content_type,
        'Content-Length': String(row.size_bytes),
        'Content-Disposition': `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cache-Control': 'private, no-store',
        'X-Document-SHA256': row.sha256,
      });
      stream.pipe(res);
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requirePermission('documents:delete'), authorizeResource('document'), async (req, res, next) => {
  try {
    const key = await documentsRepo.deleteDocument(req.params.id);
    if (key === false) return res.status(404).json({ error: 'Not found' });
    if (key) await storage.remove(key).catch(err => console.error(`[DOCS] could not remove file ${key}: ${err.message}`));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
