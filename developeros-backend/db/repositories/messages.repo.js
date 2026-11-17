// ══════════════════════════════════════════════════════════════
// db/repositories/messages.repo.js — Channels & Messages Repository
// ══════════════════════════════════════════════════════════════

const { query } = require('../pool');
const { v4: uuidv4 } = require('uuid');

async function getChannels(projectId = null, organizationId) {
  let sql = 'SELECT channels.* FROM channels JOIN projects ON projects.id = channels.project_id WHERE projects.organization_id = $1';
  const params = [organizationId];
  if (projectId) {
    sql += ' AND project_id = $2';
    params.push(projectId);
  }
  sql += ' ORDER BY id ASC';
  const { rows } = await query(sql, params);
  return rows.map(r => ({
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    desc: r.description || '',
    unread: Number(r.unread || 0),
  }));
}

async function getMessages(channelId) {
  // Mark channel as read
  await query('UPDATE channels SET unread = 0 WHERE id = $1', [channelId]);

  const { rows } = await query(`
    SELECT * FROM messages WHERE channel_id = $1 ORDER BY timestamp ASC
  `, [channelId]);

  return rows.map(r => ({
    id: r.id,
    channelId: r.channel_id,
    senderName: r.sender_name,
    senderInitials: r.sender_initials,
    senderColor: r.sender_color,
    role: r.role,
    text: r.text,
    timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp,
  }));
}

async function createChannel(data) {
  const id = 'ch' + uuidv4().replace(/-/g, '');
  const { rows } = await query(`
    INSERT INTO channels (id, project_id, name, description, unread, created_at)
    VALUES ($1, $2, $3, $4, 0, NOW())
    RETURNING *
  `, [id, data.projectId, data.name, data.desc || data.description || '']);

  return {
    id: rows[0].id,
    projectId: rows[0].project_id,
    name: rows[0].name,
    desc: rows[0].description,
    unread: 0,
  };
}

// Stable avatar color per member (display only).
const SENDER_COLORS = ['#1A2332', '#2A7A6A', '#3A6A9A', '#C4973A', '#A84A3A', '#5A4A8A', '#3A7A4A'];
function colorFor(userId) {
  let h = 0;
  for (const ch of String(userId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SENDER_COLORS[h % SENDER_COLORS.length];
}

// data: { text, sender: { userId, name, roleName } } — sender is the authenticated member.
async function sendMessage(channelId, data) {
  const id = 'm' + uuidv4().replace(/-/g, '');
  const name = data.sender.name || 'Member';
  const initials = name.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase().slice(0, 4);
  const { rows } = await query(`
    INSERT INTO messages (id, channel_id, sender_name, sender_initials, sender_color, role, text, sender_user_id, timestamp)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    RETURNING *
  `, [id, channelId, name, initials, colorFor(data.sender.userId), data.sender.roleName || null, data.text, data.sender.userId]);

  return {
    id: rows[0].id,
    channelId: rows[0].channel_id,
    senderName: rows[0].sender_name,
    senderInitials: rows[0].sender_initials,
    senderColor: rows[0].sender_color,
    role: rows[0].role,
    text: rows[0].text,
    timestamp: rows[0].timestamp,
  };
}

module.exports = {
  getChannels,
  getMessages,
  createChannel,
  sendMessage,
};
