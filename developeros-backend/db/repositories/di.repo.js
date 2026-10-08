// ══════════════════════════════════════════════════════════════
// db/repositories/di.repo.js — Development Intelligence data access
// Every statement is scoped by organization_id; a record of another tenant
// is indistinguishable from a missing one (callers return 404).
// ══════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { query, transaction } = require('../pool');
const readiness = require('../../intelligence/readiness');

const iso = v => (v ? new Date(v).toISOString() : null);
const provenance = r => ({ sourceType: r.source_type, sourceReference: r.source_reference, recordedBy: r.recorded_by, recordedAt: iso(r.created_at || r.recorded_at) });

const toRelationship = r => r && ({
  id: r.id, organizationId: r.organization_id, name: r.name, relationshipType: r.relationship_type, status: r.status,
  provenance: provenance(r), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
});
const toProperty = r => r && ({
  id: r.id, organizationId: r.organization_id, name: r.name,
  address: { street: r.street_address, city: r.city, region: r.region, postalCode: r.postal_code, country: r.country },
  apn: r.apn, provenance: provenance(r), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
});
const toOpportunity = r => r && ({
  id: r.id, organizationId: r.organization_id, name: r.name, propertyId: r.property_id, relationshipId: r.relationship_id,
  responsibleUserId: r.responsible_user_id, status: r.status, concept: { description: r.concept_description },
  provenance: provenance(r), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
});
const toFact = r => ({
  value: r.value, status: r.value_status, version: r.version,
  provenance: { sourceType: r.source_type, sourceReference: r.source_reference, recordedBy: r.recorded_by, recordedAt: iso(r.recorded_at) },
});

// ── relationships ────────────────────────────────────────────────────────────
async function listRelationships(org) {
  const { rows } = await query('SELECT * FROM di_relationships WHERE organization_id = $1 ORDER BY created_at, id', [org]);
  return rows.map(toRelationship);
}
async function getRelationship(org, id) {
  const { rows } = await query('SELECT * FROM di_relationships WHERE organization_id = $1 AND id = $2', [org, id]);
  return toRelationship(rows[0]);
}
async function createRelationship(org, actor, b) {
  const { rows } = await query(`INSERT INTO di_relationships (id, organization_id, name, relationship_type, status, source_type, source_reference, recorded_by)
    VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $6, $7) RETURNING *`,
  [crypto.randomUUID(), org, b.name, b.relationshipType, b.provenance.sourceType, b.provenance.sourceReference || null, actor]);
  return toRelationship(rows[0]);
}
async function updateRelationship(org, id, b) {
  const { rows } = await query(`UPDATE di_relationships SET
      name = COALESCE($3, name), relationship_type = COALESCE($4, relationship_type), status = COALESCE($5, status), updated_at = now()
    WHERE organization_id = $1 AND id = $2 RETURNING *`, [org, id, b.name ?? null, b.relationshipType ?? null, b.status ?? null]);
  return toRelationship(rows[0]);
}

// ── properties ───────────────────────────────────────────────────────────────
async function listProperties(org) {
  const { rows } = await query('SELECT * FROM di_properties WHERE organization_id = $1 ORDER BY created_at, id', [org]);
  return rows.map(toProperty);
}
async function getPropertyRow(org, id) {
  const { rows } = await query('SELECT * FROM di_properties WHERE organization_id = $1 AND id = $2', [org, id]);
  return rows[0] || null;
}
async function getProperty(org, id) { return toProperty(await getPropertyRow(org, id)); }
async function createProperty(org, actor, b) {
  const a = b.address || {};
  const { rows } = await query(`INSERT INTO di_properties (id, organization_id, name, street_address, city, region, postal_code, country, apn, source_type, source_reference, recorded_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
  [crypto.randomUUID(), org, b.name, a.street || null, a.city || null, a.region || null, a.postalCode || null, a.country || null,
    b.apn || null, b.provenance.sourceType, b.provenance.sourceReference || null, actor]);
  return toProperty(rows[0]);
}
async function updateProperty(org, id, b) {
  const a = b.address || {};
  const { rows } = await query(`UPDATE di_properties SET
      name = COALESCE($3, name), apn = COALESCE($4, apn), street_address = COALESCE($5, street_address), city = COALESCE($6, city),
      region = COALESCE($7, region), postal_code = COALESCE($8, postal_code), country = COALESCE($9, country), updated_at = now()
    WHERE organization_id = $1 AND id = $2 RETURNING *`,
  [org, id, b.name ?? null, b.apn ?? null, a.street ?? null, a.city ?? null, a.region ?? null, a.postalCode ?? null, a.country ?? null]);
  return toProperty(rows[0]);
}

// ── site intelligence ────────────────────────────────────────────────────────
async function getSiteIntelligence(org, propertyId) {
  const facts = (await readiness.currentFactsByProperty({ query }, org, [propertyId])).get(propertyId) || new Map();
  const out = {};
  for (const [key, row] of [...facts.entries()].sort()) out[key] = toFact(row);
  return { propertyId, facts: out };
}
async function getSiteIntelligenceHistory(org, propertyId) {
  const { rows } = await query(`SELECT * FROM di_site_facts WHERE organization_id = $1 AND property_id = $2 ORDER BY fact_key, version`, [org, propertyId]);
  return rows.map(r => ({ key: r.fact_key, ...toFact(r) }));
}
// Writes a new version for each fact whose value or status changed.
async function putSiteFacts(org, propertyId, actor, facts) {
  return transaction(async client => {
    // Serializes concurrent writers per property so version numbers stay contiguous.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`devos-di-facts:${propertyId}`]);
    const { rows } = await client.query(`SELECT DISTINCT ON (fact_key) fact_key, value, value_status, version FROM di_site_facts
      WHERE organization_id = $1 AND property_id = $2 ORDER BY fact_key, version DESC`, [org, propertyId]);
    const current = new Map(rows.map(r => [r.fact_key, r]));
    for (const [key, f] of Object.entries(facts)) {
      const prev = current.get(key);
      const value = f.value === null || f.value === undefined ? null : f.value;
      if (prev && prev.value_status === f.status && JSON.stringify(prev.value) === JSON.stringify(value)) continue;
      const version = prev ? prev.version + 1 : 1;
      await client.query(`INSERT INTO di_site_facts (id, organization_id, property_id, fact_key, value, value_status, version, source_type, source_reference, recorded_by)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)`,
      [crypto.randomUUID(), org, propertyId, key, value === null ? null : JSON.stringify(value), f.status, version,
        f.provenance.sourceType, f.provenance.sourceReference || null, actor]);
    }
  });
}

// ── opportunities ────────────────────────────────────────────────────────────
async function listOpportunities(org) {
  const { rows } = await query('SELECT * FROM di_opportunities WHERE organization_id = $1 ORDER BY created_at, id', [org]);
  return rows.map(toOpportunity);
}
async function getOpportunityRow(org, id, db = { query }) {
  const { rows } = await db.query('SELECT * FROM di_opportunities WHERE organization_id = $1 AND id = $2', [org, id]);
  return rows[0] || null;
}
async function getOpportunity(org, id) { return toOpportunity(await getOpportunityRow(org, id)); }
async function isActiveMember(org, userId) {
  const { rowCount } = await query(`SELECT 1 FROM memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'ACTIVE'`, [org, userId]);
  return rowCount > 0;
}
async function createOpportunity(org, actor, b) {
  return transaction(async client => {
    const id = crypto.randomUUID();
    const { rows } = await client.query(`INSERT INTO di_opportunities (id, organization_id, property_id, relationship_id, name, status, concept_description,
        responsible_user_id, source_type, source_reference, recorded_by)
      VALUES ($1, $2, $3, $4, $5, 'NEW', $6, $7, $8, $9, $10) RETURNING *`,
    [id, org, b.propertyId || null, b.relationshipId || null, b.name, b.concept?.description ?? null, b.responsibleUserId || null,
      b.provenance.sourceType, b.provenance.sourceReference || null, actor]);
    await client.query(`INSERT INTO di_opportunity_status_history (id, organization_id, opportunity_id, from_status, to_status, reason, changed_by)
      VALUES ($1, $2, $3, NULL, 'NEW', 'Opportunity created', $4)`, [crypto.randomUUID(), org, id, actor]);
    return toOpportunity(rows[0]);
  });
}
// Lifecycle status is never changed here — only through transition().
async function updateOpportunity(org, id, b) {
  const set = [];
  const params = [org, id];
  const add = (col, val) => { params.push(val); set.push(`${col} = $${params.length}`); };
  if (b.name !== undefined) add('name', b.name);
  if (b.propertyId !== undefined) add('property_id', b.propertyId || null);
  if (b.relationshipId !== undefined) add('relationship_id', b.relationshipId || null);
  if (b.responsibleUserId !== undefined) add('responsible_user_id', b.responsibleUserId || null);
  if (b.concept && b.concept.description !== undefined) add('concept_description', b.concept.description);
  set.push('updated_at = now()');
  const { rows } = await query(`UPDATE di_opportunities SET ${set.join(', ')} WHERE organization_id = $1 AND id = $2 RETURNING *`, params);
  return toOpportunity(rows[0]);
}
async function readinessFor(org, row, db = { query }) {
  const facts = row.property_id ? (await readiness.currentFactsByProperty(db, org, [row.property_id])).get(row.property_id) : null;
  return readiness.assess(row, facts);
}
async function transitionOpportunity(org, id, actor, to, reason, guard) {
  return transaction(async client => {
    const { rows: [row] } = await client.query('SELECT * FROM di_opportunities WHERE organization_id = $1 AND id = $2 FOR UPDATE', [org, id]);
    if (!row) return { notFound: true };
    const verdict = await guard(row, client);
    if (verdict) return verdict;
    const { rows: [updated] } = await client.query(`UPDATE di_opportunities SET status = $3, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING *`, [org, id, to]);
    await client.query(`INSERT INTO di_opportunity_status_history (id, organization_id, opportunity_id, from_status, to_status, reason, changed_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`, [crypto.randomUUID(), org, id, row.status, to, reason, actor]);
    return { opportunity: toOpportunity(updated) };
  });
}
async function opportunityHistory(org, id) {
  const { rows } = await query(`SELECT * FROM di_opportunity_status_history WHERE organization_id = $1 AND opportunity_id = $2 ORDER BY changed_at, id`, [org, id]);
  return rows.map(r => ({ fromStatus: r.from_status, toStatus: r.to_status, reason: r.reason, changedBy: r.changed_by, changedAt: iso(r.changed_at) }));
}

module.exports = {
  listRelationships, getRelationship, createRelationship, updateRelationship,
  listProperties, getProperty, getPropertyRow, createProperty, updateProperty,
  getSiteIntelligence, getSiteIntelligenceHistory, putSiteFacts,
  listOpportunities, getOpportunity, getOpportunityRow, createOpportunity, updateOpportunity, isActiveMember,
  readinessFor, transitionOpportunity, opportunityHistory,
};
