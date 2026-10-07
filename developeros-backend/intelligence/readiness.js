// ══════════════════════════════════════════════════════════════
// intelligence/readiness.js — DI-1 information sufficiency (Gate 0 foundation)
//
// Information readiness only: reports whether the facts needed to begin
// qualification are known. It never judges strategic fit or economics and
// never produces a decision. Missing information is not a failed deal.
// ══════════════════════════════════════════════════════════════

// Platform-neutral baseline (contract §6). No tenant policy, no thresholds.
const SITE_REQUIREMENTS = ['apn', 'ownership', 'lot_area_sqft', 'zoning', 'current_use', 'acquisition_basis'];
const REQUIREMENT_KEYS = ['opportunity.property', 'opportunity.concept', ...SITE_REQUIREMENTS.map(k => `site.${k}`)];
const SATISFYING_STATUSES = new Set(['KNOWN', 'NOT_APPLICABLE']);

// opportunity: { id, property_id, concept_description }
// currentFacts: Map<factKey, { value_status }> — the property's current fact versions
function assess(opportunity, currentFacts) {
  const facts = currentFacts || new Map();
  const satisfied = {
    'opportunity.property': !!opportunity.property_id,
    'opportunity.concept': typeof opportunity.concept_description === 'string' && opportunity.concept_description.trim().length > 0,
  };
  for (const key of SITE_REQUIREMENTS) {
    const fact = opportunity.property_id ? facts.get(key) : null;
    satisfied[`site.${key}`] = !!fact && SATISFYING_STATUSES.has(fact.value_status);
  }
  const requirements = REQUIREMENT_KEYS.map(key => ({ key, satisfied: satisfied[key] }));
  const missing = requirements.filter(r => !r.satisfied).map(r => r.key);
  return {
    opportunityId: opportunity.id,
    status: missing.length ? 'INFORMATION_REQUIRED' : 'READY_FOR_QUALIFICATION',
    requirements,
    missing,
  };
}

// Current version of every fact for the given properties: Map<propertyId, Map<key, row>>.
async function currentFactsByProperty(db, organizationId, propertyIds) {
  const result = new Map();
  if (!propertyIds.length) return result;
  const { rows } = await db.query(`
    SELECT DISTINCT ON (property_id, fact_key) property_id, fact_key, value, value_status, version,
           source_type, source_reference, recorded_by, recorded_at
    FROM di_site_facts
    WHERE organization_id = $1 AND property_id = ANY($2)
    ORDER BY property_id, fact_key, version DESC`, [organizationId, propertyIds]);
  for (const r of rows) {
    if (!result.has(r.property_id)) result.set(r.property_id, new Map());
    result.get(r.property_id).set(r.fact_key, r);
  }
  return result;
}

module.exports = { assess, currentFactsByProperty, REQUIREMENT_KEYS, SITE_REQUIREMENTS };
