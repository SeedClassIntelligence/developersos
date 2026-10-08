// ═══════════════════════════════════════════════
// pages/intelligence.js — Development Intelligence (WP3)
// Relationships → Property → Opportunity → Site Intelligence → Readiness,
// plus findings. Operates the DI-1 API; the server enforces every rule
// (permissions, tenant scope, lifecycle, readiness) and the UI reports it.
// ═══════════════════════════════════════════════

(function (global) {
  const Pages = (global.Pages = global.Pages || {});
  const DI = '/intelligence';

  const OPP_STATUS = {
    NEW: { label: 'New', kind: 'navy' },
    SCREENING: { label: 'Screening', kind: 'blue' },
    INFORMATION_REQUIRED: { label: 'Information Required', kind: 'amber' },
    READY_FOR_QUALIFICATION: { label: 'Ready for Qualification', kind: 'green' },
    DECLINED: { label: 'Declined', kind: 'red' },
    WITHDRAWN: { label: 'Withdrawn', kind: 'navy' },
    EXPIRED: { label: 'Expired', kind: 'navy' },
  };
  // Mirrors the server's lifecycle so only meaningful actions are offered; the server decides.
  const TRANSITIONS = {
    NEW: ['SCREENING', 'DECLINED', 'WITHDRAWN'],
    SCREENING: ['INFORMATION_REQUIRED', 'READY_FOR_QUALIFICATION', 'DECLINED', 'WITHDRAWN', 'EXPIRED'],
    INFORMATION_REQUIRED: ['SCREENING', 'READY_FOR_QUALIFICATION', 'DECLINED', 'WITHDRAWN', 'EXPIRED'],
    READY_FOR_QUALIFICATION: ['INFORMATION_REQUIRED', 'DECLINED', 'WITHDRAWN', 'EXPIRED'],
    DECLINED: [], WITHDRAWN: [], EXPIRED: [],
  };
  const FACTS = [
    ['apn', 'APN', 'text', true], ['ownership', 'Ownership', 'text', true], ['lot_area_sqft', 'Lot area (sq ft)', 'number', true],
    ['zoning', 'Zoning', 'text', true], ['current_use', 'Current use', 'text', true], ['acquisition_basis', 'Acquisition basis ($)', 'money', true],
    ['acquisition_structure', 'Acquisition structure', 'text'], ['future_land_use', 'Future land use', 'text'], ['overlays', 'Overlays', 'text'],
    ['density_du_per_acre', 'Density (du/acre)', 'number'], ['far', 'FAR', 'number'], ['height_limit_ft', 'Height limit (ft)', 'number'],
    ['setbacks', 'Setbacks', 'text'], ['parking', 'Parking', 'text'], ['utilities', 'Utilities', 'text'], ['access', 'Access', 'text'],
    ['easements', 'Easements', 'text'], ['flood_zone', 'Flood zone', 'text'], ['environmental', 'Environmental', 'text'],
    ['demolition', 'Demolition', 'text'], ['entitlement_path', 'Entitlement path', 'text'], ['known_constraints', 'Known constraints', 'text'],
  ].map(([key, label, type, gate0]) => ({ key, label, type, gate0: !!gate0 }));
  const FACT = Object.fromEntries(FACTS.map(f => [f.key, f]));
  const FACT_STATUS = { KNOWN: 'green', UNKNOWN: 'amber', NOT_APPLICABLE: 'navy' };
  const SOURCES = [
    { value: 'USER_ENTRY', label: 'User entry' }, { value: 'PUBLIC_RECORD', label: 'Public record' },
    { value: 'DOCUMENT', label: 'Document' }, { value: 'CONNECTED_SYSTEM', label: 'Connected system' },
  ];
  const RELATIONSHIP_TYPES = ['broker', 'seller', 'landowner', 'municipality', 'lender', 'investor', 'partner', 'consultant'];
  const SEVERITY_KIND = { critical: 'red', warning: 'amber', info: 'blue' };
  const FINDING_STATE_KIND = { OPEN: 'red', ACKNOWLEDGED: 'amber', RESOLVED: 'green' };

  const oppStatus = s => OPP_STATUS[s] || { label: UI.titleCase(s), kind: 'navy' };
  const who = id => Store.memberName(id);
  const sourceLabel = v => (SOURCES.find(s => s.value === v) || { label: UI.titleCase(v || '') }).label;
  const requirementLabel = key => key === 'opportunity.property' ? 'Property linked'
    : key === 'opportunity.concept' ? 'Development concept described'
      : key.startsWith('site.') ? (FACT[key.slice(5)] || { label: key }).label : key;
  const addressLine = a => [a && a.street, a && a.city, a && a.region, a && a.postalCode, a && a.country].filter(Boolean).join(', ');

  function factValue(key, fact) {
    if (!fact) return html`<span class="cell-dim">Not recorded</span>`;
    if (fact.status !== 'KNOWN') return html`<span class="cell-dim">${UI.titleCase(fact.status.toLowerCase())}</span>`;
    const v = fact.value;
    const def = FACT[key];
    if (def && def.type === 'money' && typeof v === 'number') return UI.money(v);
    if (def && def.type === 'number' && typeof v === 'number') return UI.number(v);
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }

  function provenanceFields(prefix = '') {
    return html`
      <div class="form-grid">
        ${UI.select({ name: `${prefix}sourceType`, label: 'Source', options: SOURCES, value: 'USER_ENTRY' })}
        ${UI.field({ name: `${prefix}sourceReference`, label: 'Source reference (optional)', placeholder: 'e.g. county assessor record, broker OM p.4' })}
      </div>`;
  }
  const readProvenance = (form, prefix = '') => ({
    sourceType: form[`${prefix}sourceType`].value,
    sourceReference: form[`${prefix}sourceReference`].value.trim() || undefined,
  });

  const backLink = (href, label) => html`<a class="back-link" href="#${href}">← ${label}</a>`;

  // ── Pipeline (opportunities) ─────────────────
  Pages.opportunities = {
    title: () => 'Pipeline',
    async render(ctx) {
      const [opps, properties] = await Promise.all([Api.get('/di/opportunities'), Api.get('/di/properties')]);
      const status = ctx.query.status || '';
      const shown = status ? opps.filter(o => o.status === status) : opps;
      const propName = id => (properties.find(p => p.id === id) || {}).name;
      return html`
        <div class="page">
          ${UI.pageHeader('Pipeline', 'Development opportunities from sourcing through readiness for qualification',
            Session.can('opportunities:create') ? html`<a class="btn btn-navy btn-sm" href="#${DI}/opportunities/new" data-testid="new-opportunity">+ New opportunity</a>` : '')}
          <div class="chip-row">
            <a class="chip ${status ? '' : 'on'}" href="#${DI}/opportunities">All (${opps.length})</a>
            ${Object.keys(OPP_STATUS).filter(s => opps.some(o => o.status === s)).map(s => html`
              <a class="chip ${s === status ? 'on' : ''}" href="#${DI}/opportunities?status=${s}">${OPP_STATUS[s].label} (${opps.filter(o => o.status === s).length})</a>`)}
          </div>
          ${UI.table([
            { label: 'Opportunity', cell: o => html`<a class="cell-link" href="#${DI}/opportunities/${encodeURIComponent(o.id)}" data-testid="opportunity-link">${o.name}</a>` },
            { label: 'Status', cell: o => UI.badge(oppStatus(o.status).label, oppStatus(o.status).kind) },
            { label: 'Property', cell: o => (o.propertyId ? html`<a class="cell-link-dim" href="#${DI}/properties/${encodeURIComponent(o.propertyId)}">${propName(o.propertyId) || 'Property'}</a>` : html`<span class="cell-dim">None linked</span>`) },
            { label: 'Updated', cell: o => UI.dateTime(o.updatedAt), className: 'mono' },
          ], shown, { empty: opps.length ? 'No opportunities in this status.' : 'No opportunities yet. Record the first one to start your pipeline.' })}
        </div>`;
    },
  };

  function opportunityForm({ opp = {}, properties, relationships, formName, submitLabel, withProvenance }) {
    return html`
      <form class="card form-card" data-form="${formName}" ${opp.id ? html`data-id="${opp.id}"` : ''} data-testid="${formName}" novalidate>
        ${UI.field({ name: 'name', label: 'Opportunity name', value: opp.name || '', required: true })}
        ${UI.textarea({ name: 'concept', label: 'Development concept', value: (opp.concept && opp.concept.description) || '', placeholder: 'What could be built here, for whom, at what scale' })}
        <div class="form-grid">
          ${UI.select({ name: 'propertyId', label: 'Property', value: opp.propertyId || '', testid: 'opp-property',
            options: [{ value: '', label: 'Not linked yet' }, ...properties.map(p => ({ value: p.id, label: p.name }))] })}
          ${UI.select({ name: 'relationshipId', label: 'Source relationship', value: opp.relationshipId || '',
            options: [{ value: '', label: 'None' }, ...relationships.map(r => ({ value: r.id, label: `${r.name} (${r.relationshipType})` }))] })}
        </div>
        ${withProvenance ? provenanceFields() : ''}
        ${UI.formError()}
        <div class="form-actions">
          <button class="btn btn-navy btn-sm" type="submit">${submitLabel}</button>
          ${opp.id ? html`<a class="btn btn-o btn-sm" href="#${DI}/opportunities/${encodeURIComponent(opp.id)}">Cancel</a>` : html`<a class="btn btn-o btn-sm" href="#${DI}/opportunities">Cancel</a>`}
        </div>
      </form>`;
  }
  const readOpportunity = form => ({
    name: form.name.value.trim(),
    concept: { description: form.concept.value.trim() },
    propertyId: form.propertyId.value || null,
    relationshipId: form.relationshipId.value || null,
  });

  Pages.opportunityNew = {
    title: () => 'New opportunity',
    async render(ctx) {
      const [properties, relationships] = await Promise.all([Api.get('/di/properties'), Api.get('/di/relationships')]);
      const preset = { propertyId: ctx.query.propertyId || '' };
      return html`
        <div class="page page-narrow">
          ${backLink(`${DI}/opportunities`, 'Pipeline')}
          ${UI.pageHeader('New opportunity', 'Record a potential development. It starts in New and moves through screening to readiness.')}
          ${opportunityForm({ opp: preset, properties, relationships: relationships.filter(r => r.status === 'ACTIVE'), formName: 'opportunity-create', submitLabel: 'Create opportunity', withProvenance: true })}
        </div>`;
    },
  };

  Actions.onSubmit('opportunity-create', async form => {
    const body = readOpportunity(form);
    const created = await UI.submit(form, () => {
      if (!body.name) throw new Error('Name is required.');
      const payload = { name: body.name, concept: body.concept, provenance: readProvenance(form) };
      if (body.propertyId) payload.propertyId = body.propertyId;
      if (body.relationshipId) payload.relationshipId = body.relationshipId;
      return Api.post('/di/opportunities', payload);
    });
    if (!created) return;
    UI.toast('Opportunity created', 'success');
    Router.go(`${DI}/opportunities/${encodeURIComponent(created.id)}`);
  });

  Pages.opportunity = {
    title: () => 'Opportunity',
    async render(ctx) {
      await Store.getMembers();
      const id = encodeURIComponent(ctx.params.id);
      const [opp, readiness, history, properties, relationships] = await Promise.all([
        Api.get(`/di/opportunities/${id}`), Api.get(`/di/opportunities/${id}/readiness`), Api.get(`/di/opportunities/${id}/history`),
        Api.get('/di/properties'), Api.get('/di/relationships'),
      ]);
      const st = oppStatus(opp.status);
      const property = properties.find(p => p.id === opp.propertyId);
      const relationship = relationships.find(r => r.id === opp.relationshipId);
      const next = TRANSITIONS[opp.status] || [];
      const editing = ctx.query.edit === '1' && Session.can('opportunities:update');
      const ready = readiness.status === 'READY_FOR_QUALIFICATION';

      return html`
        <div class="page">
          ${backLink(`${DI}/opportunities`, 'Pipeline')}
          ${UI.pageHeader(opp.name, html`${UI.badge(st.label, st.kind)} <span class="meta-dim">Recorded ${UI.date(opp.createdAt)} by ${who(opp.provenance.recordedBy)} · source: ${sourceLabel(opp.provenance.sourceType)}</span>`,
            Session.can('opportunities:update') && !editing ? html`<a class="btn btn-o btn-sm" href="#${DI}/opportunities/${id}?edit=1" data-testid="edit-opportunity">Edit details</a>` : '')}
          <div class="detail-grid">
            <div>
              ${editing ? opportunityForm({ opp, properties, relationships, formName: 'opportunity-update', submitLabel: 'Save changes' }) : html`
                <section class="card">
                  <h2 class="section-h">Concept</h2>
                  <p class="prose" data-testid="opp-concept">${(opp.concept && opp.concept.description) || html`<span class="cell-dim">No concept described yet.</span>`}</p>
                  <dl class="kv">
                    <div><dt>Property</dt><dd>${property ? html`<a class="cell-link" href="#${DI}/properties/${encodeURIComponent(property.id)}" data-testid="opp-property-link">${property.name}</a>` : 'Not linked'}</dd></div>
                    <div><dt>Source relationship</dt><dd>${relationship ? html`${relationship.name} <span class="cell-dim">(${relationship.relationshipType})</span>` : 'None'}</dd></div>
                  </dl>
                </section>`}
              <section class="card">
                <h2 class="section-h">Lifecycle</h2>
                ${next.length && Session.can('opportunities:transition') ? html`
                  <form data-form="opportunity-transition" data-id="${opp.id}" data-testid="transition-form" novalidate>
                    <div class="form-grid">
                      ${UI.select({ name: 'to', label: 'Move to', testid: 'transition-to', options: next.map(s => ({ value: s, label: OPP_STATUS[s].label })) })}
                    </div>
                    ${UI.textarea({ name: 'reason', label: 'Reason (recorded in the history)', required: true, rows: 2 })}
                    ${UI.formError()}
                    <div class="form-actions"><button class="btn btn-navy btn-sm" type="submit">Record transition</button></div>
                  </form>` : html`<p class="cell-dim">${next.length ? 'You do not have permission to change the lifecycle.' : `${st.label} is a final state.`}</p>`}
                <h3 class="sub-h">History</h3>
                <ol class="timeline" data-testid="opp-history">
                  ${history.slice().reverse().map(h => html`
                    <li><span class="tl-when mono">${UI.dateTime(h.changedAt)}</span>
                      <span>${h.fromStatus ? html`${oppStatus(h.fromStatus).label} → ` : ''}<strong>${oppStatus(h.toStatus).label}</strong></span>
                      <span class="tl-reason">${h.reason} — ${who(h.changedBy)}</span></li>`)}
                </ol>
              </section>
            </div>
            <aside class="card readiness ${ready ? 'is-ready' : ''}" data-testid="readiness">
              <h2 class="section-h">Gate 0 — information readiness</h2>
              <div class="readiness-status">${ready ? '✓ Ready for qualification' : `${readiness.missing.length} item${readiness.missing.length === 1 ? '' : 's'} missing`}</div>
              <ul class="req-list">
                ${readiness.requirements.map(r => html`<li class="${r.satisfied ? 'ok' : 'missing'}" data-testid="requirement"><span aria-hidden="true">${r.satisfied ? '✓' : '○'}</span> ${requirementLabel(r.key)}</li>`)}
              </ul>
              ${!ready && property && Session.can('site_intelligence:update') ? html`<a class="btn btn-o btn-sm" href="#${DI}/properties/${encodeURIComponent(property.id)}?edit=facts">Complete site intelligence →</a>` : ''}
              <p class="fine">Readiness measures whether enough is known to begin qualification. Missing information is never a negative decision.</p>
            </aside>
          </div>
        </div>`;
    },
  };

  Actions.onSubmit('opportunity-update', async form => {
    const id = form.dataset.id;
    const body = readOpportunity(form);
    const saved = await UI.submit(form, () => {
      if (!body.name) throw new Error('Name is required.');
      return Api.patch(`/di/opportunities/${encodeURIComponent(id)}`, body);
    });
    if (!saved) return;
    UI.toast('Opportunity updated', 'success');
    Router.go(`${DI}/opportunities/${encodeURIComponent(id)}`);
  });

  Actions.onSubmit('opportunity-transition', async form => {
    const id = form.dataset.id;
    const to = form.to.value;
    const reason = form.reason.value.trim();
    const moved = await UI.submit(form, () => {
      if (!reason) throw new Error('A reason is required for every lifecycle change.');
      return Api.post(`/di/opportunities/${encodeURIComponent(id)}/transition`, { to, reason });
    }, { missingLabel: requirementLabel });
    if (!moved) return;
    UI.toast(`Moved to ${oppStatus(moved.status).label}`, 'success');
    App.rerender();
  });

  // ── Properties & site intelligence ───────────
  Pages.properties = {
    title: () => 'Properties',
    async render() {
      const properties = await Api.get('/di/properties');
      return html`
        <div class="page">
          ${UI.pageHeader('Properties', 'Sites under consideration, with versioned site intelligence',
            Session.can('properties:create') ? html`<a class="btn btn-navy btn-sm" href="#${DI}/properties/new" data-testid="new-property">+ New property</a>` : '')}
          ${UI.table([
            { label: 'Property', cell: p => html`<a class="cell-link" href="#${DI}/properties/${encodeURIComponent(p.id)}" data-testid="property-link">${p.name}</a>` },
            { label: 'Address', cell: p => addressLine(p.address) || html`<span class="cell-dim">—</span>`, className: 'cell-dim' },
            { label: 'APN', cell: p => p.apn || '—', className: 'mono' },
            { label: 'Recorded', cell: p => UI.date(p.createdAt), className: 'mono' },
          ], properties, { empty: 'No properties yet. Add the first site you are evaluating.' })}
        </div>`;
    },
  };

  function propertyForm(p, formName, submitLabel, withProvenance) {
    const a = p.address || {};
    return html`
      <form class="card form-card" data-form="${formName}" ${p.id ? html`data-id="${p.id}"` : ''} data-testid="${formName}" novalidate>
        ${UI.field({ name: 'name', label: 'Property name', value: p.name || '', required: true })}
        ${UI.field({ name: 'street', label: 'Street address', value: a.street || '' })}
        <div class="form-grid">
          ${UI.field({ name: 'city', label: 'City', value: a.city || '' })}
          ${UI.field({ name: 'region', label: 'State / region', value: a.region || '' })}
          ${UI.field({ name: 'postalCode', label: 'Postal code', value: a.postalCode || '' })}
          ${UI.field({ name: 'country', label: 'Country', value: a.country || '' })}
        </div>
        ${UI.field({ name: 'apn', label: 'APN (parcel number)', value: p.apn || '' })}
        ${withProvenance ? provenanceFields() : ''}
        ${UI.formError()}
        <div class="form-actions">
          <button class="btn btn-navy btn-sm" type="submit">${submitLabel}</button>
          <a class="btn btn-o btn-sm" href="#${DI}/properties${p.id ? `/${encodeURIComponent(p.id)}` : ''}">Cancel</a>
        </div>
      </form>`;
  }
  const readProperty = form => {
    const v = n => form[n].value.trim() || undefined;
    return { name: form.name.value.trim(), apn: v('apn'), address: { street: v('street'), city: v('city'), region: v('region'), postalCode: v('postalCode'), country: v('country') } };
  };

  Pages.propertyNew = {
    title: () => 'New property',
    render() {
      return html`
        <div class="page page-narrow">
          ${backLink(`${DI}/properties`, 'Properties')}
          ${UI.pageHeader('New property', 'Record a site. Site intelligence (zoning, ownership, constraints…) is captured on the property page.')}
          ${propertyForm({}, 'property-create', 'Create property', true)}
        </div>`;
    },
  };

  Actions.onSubmit('property-create', async form => {
    const body = readProperty(form);
    const created = await UI.submit(form, () => {
      if (!body.name) throw new Error('Name is required.');
      return Api.post('/di/properties', { ...body, provenance: readProvenance(form) });
    });
    if (!created) return;
    UI.toast('Property created', 'success');
    Router.go(`${DI}/properties/${encodeURIComponent(created.id)}`);
  });

  Actions.onSubmit('property-update', async form => {
    const id = form.dataset.id;
    const body = readProperty(form);
    const saved = await UI.submit(form, () => {
      if (!body.name) throw new Error('Name is required.');
      return Api.patch(`/di/properties/${encodeURIComponent(id)}`, body);
    });
    if (!saved) return;
    UI.toast('Property updated', 'success');
    Router.go(`${DI}/properties/${encodeURIComponent(id)}`);
  });

  Pages.property = {
    title: () => 'Property',
    async render(ctx) {
      await Store.getMembers();
      const id = encodeURIComponent(ctx.params.id);
      const [property, site, opps] = await Promise.all([
        Api.get(`/di/properties/${id}`), Api.get(`/di/properties/${id}/site-intelligence`), Api.get('/di/opportunities'),
      ]);
      const mode = ctx.query.edit;
      const showHistory = ctx.query.history === '1';
      const history = showHistory ? await Api.get(`/di/properties/${id}/site-intelligence/history`) : [];
      const linked = opps.filter(o => o.propertyId === property.id);
      const facts = site.facts || {};
      const gate0 = FACTS.filter(f => f.gate0);
      const gate0Done = gate0.filter(f => facts[f.key] && facts[f.key].status !== 'UNKNOWN').length;
      const canEditFacts = Session.can('site_intelligence:update');

      return html`
        <div class="page">
          ${backLink(`${DI}/properties`, 'Properties')}
          ${UI.pageHeader(property.name, html`${addressLine(property.address) || 'No address recorded'}${property.apn ? html` · APN <span class="mono">${property.apn}</span>` : ''}`,
            html`${Session.can('properties:update') && mode !== '1' ? html`<a class="btn btn-o btn-sm" href="#${DI}/properties/${id}?edit=1">Edit property</a>` : ''}
                 ${Session.can('opportunities:create') ? html`<a class="btn btn-navy btn-sm" href="#${DI}/opportunities/new?propertyId=${id}">+ Opportunity on this site</a>` : ''}`)}
          ${mode === '1' && Session.can('properties:update') ? propertyForm(property, 'property-update', 'Save property', false) : ''}
          <section class="card">
            <div class="card-head">
              <div>
                <h2 class="section-h">Site intelligence</h2>
                <div class="cell-dim">Gate 0 facts recorded: ${gate0Done} of ${gate0.length}. Every change is kept as a new version with its source.</div>
              </div>
              <div class="page-actions">
                ${canEditFacts && mode !== 'facts' ? html`<a class="btn btn-navy btn-sm" href="#${DI}/properties/${id}?edit=facts" data-testid="edit-facts">Update facts</a>` : ''}
                <a class="btn btn-o btn-sm" href="#${DI}/properties/${id}${showHistory ? '' : '?history=1'}">${showHistory ? 'Hide history' : 'Version history'}</a>
              </div>
            </div>
            ${mode === 'facts' && canEditFacts ? factsForm(property.id, facts) : UI.table([
              { label: 'Fact', cell: f => html`${f.label}${f.gate0 ? html` <span class="gate-tag">Gate 0</span>` : ''}` },
              { label: 'Value', cell: f => factValue(f.key, facts[f.key]) },
              { label: 'Status', cell: f => (facts[f.key] ? UI.badge(UI.titleCase(facts[f.key].status.toLowerCase()), FACT_STATUS[facts[f.key].status]) : html`<span class="cell-dim">—</span>`) },
              { label: 'Version', cell: f => (facts[f.key] ? `v${facts[f.key].version}` : '—'), className: 'mono' },
              { label: 'Source', cell: f => (facts[f.key] ? html`${sourceLabel(facts[f.key].provenance.sourceType)}${facts[f.key].provenance.sourceReference ? html`<div class="cell-dim">${facts[f.key].provenance.sourceReference}</div>` : ''}` : '—'), className: 'cell-dim' },
            ], FACTS, { rowAttrs: f => html`data-fact="${f.key}"` })}
            ${showHistory ? html`
              <h3 class="sub-h">Version history</h3>
              ${UI.table([
                { label: 'Fact', cell: h => (FACT[h.key] || { label: h.key }).label },
                { label: 'Version', cell: h => `v${h.version}`, className: 'mono' },
                { label: 'Value', cell: h => factValue(h.key, h) },
                { label: 'Source', cell: h => sourceLabel(h.provenance.sourceType), className: 'cell-dim' },
                { label: 'Recorded', cell: h => html`${UI.dateTime(h.provenance.recordedAt)} · ${who(h.provenance.recordedBy)}`, className: 'cell-dim' },
              ], history, { empty: 'No facts recorded yet.' })}` : ''}
          </section>
          <section class="card">
            <h2 class="section-h">Opportunities on this site</h2>
            ${UI.table([
              { label: 'Opportunity', cell: o => html`<a class="cell-link" href="#${DI}/opportunities/${encodeURIComponent(o.id)}">${o.name}</a>` },
              { label: 'Status', cell: o => UI.badge(oppStatus(o.status).label, oppStatus(o.status).kind) },
            ], linked, { empty: 'No opportunities linked to this property yet.' })}
          </section>
        </div>`;
    },
  };

  function factInputValue(fact) {
    if (!fact || fact.status !== 'KNOWN' || fact.value === null || fact.value === undefined) return '';
    return typeof fact.value === 'object' ? JSON.stringify(fact.value) : String(fact.value);
  }

  function factsForm(propertyId, facts) {
    return html`
      <form data-form="site-facts" data-id="${propertyId}" data-testid="facts-form" novalidate>
        <p class="cell-dim form-hint">Set a status for each fact you know about. “Known” needs a value; “Unknown” and “Not applicable” record that explicitly. Only changed facts create new versions.</p>
        <div class="facts-grid">
          ${FACTS.map(f => {
            const cur = facts[f.key];
            return html`
              <div class="fact-row" data-fact-row="${f.key}">
                <div class="fact-label">${f.label}${f.gate0 ? html` <span class="gate-tag">Gate 0</span>` : ''}</div>
                <label><span class="sr-only">${f.label} status</span>
                  <select class="input" name="status:${f.key}" data-testid="status-${f.key}">
                    <option value="" ${cur ? '' : raw('selected')}>${cur ? 'Keep current' : 'Not recorded'}</option>
                    ${['KNOWN', 'UNKNOWN', 'NOT_APPLICABLE'].map(s => html`<option value="${s}" ${cur && cur.status === s ? raw('selected') : ''}>${UI.titleCase(s.toLowerCase())}</option>`)}
                  </select>
                </label>
                <label><span class="sr-only">${f.label} value</span>
                  <input class="input" name="value:${f.key}" data-testid="value-${f.key}" value="${factInputValue(cur)}"
                    data-original-type="${cur && cur.value !== null && typeof cur.value === 'object' ? 'json' : ''}"
                    ${f.type === 'number' || f.type === 'money' ? raw('inputmode="decimal"') : ''} placeholder="${f.type === 'text' ? 'Value' : 'Number'}">
                </label>
              </div>`;
          })}
        </div>
        ${provenanceFields()}
        ${UI.formError()}
        <div class="form-actions">
          <button class="btn btn-navy btn-sm" type="submit">Save site intelligence</button>
          <a class="btn btn-o btn-sm" href="#${DI}/properties/${encodeURIComponent(propertyId)}">Cancel</a>
        </div>
      </form>`;
  }

  Actions.onSubmit('site-facts', async form => {
    const id = form.dataset.id;
    const provenance = readProvenance(form);
    const result = await UI.submit(form, () => {
      const facts = {};
      const problems = [];
      for (const f of FACTS) {
        const status = form.elements.namedItem(`status:${f.key}`).value;
        if (!status) continue;
        const input = form.elements.namedItem(`value:${f.key}`);
        const text = input.value.trim();
        if (status !== 'KNOWN') { facts[f.key] = { status, value: null, provenance }; continue; }
        if (!text) { problems.push(`${f.label} is Known but has no value`); continue; }
        let value = text;
        if (input.dataset.originalType === 'json') {
          try { value = JSON.parse(text); } catch (e) { problems.push(`${f.label} must stay valid JSON`); continue; }
        } else if (f.type === 'number' || f.type === 'money') {
          value = Number(text.replace(/[$,\s]/g, ''));
          if (!Number.isFinite(value)) { problems.push(`${f.label} must be a number`); continue; }
        }
        facts[f.key] = { status, value, provenance };
      }
      if (problems.length) throw new Error(`${problems.join('; ')}.`);
      if (!Object.keys(facts).length) throw new Error('Set a status for at least one fact.');
      return Api.put(`/di/properties/${encodeURIComponent(id)}/site-intelligence`, { facts });
    });
    if (!result) return;
    UI.toast('Site intelligence saved', 'success');
    Router.go(`${DI}/properties/${encodeURIComponent(id)}`);
  });

  // ── Relationships ────────────────────────────
  Pages.relationships = {
    title: () => 'Relationships',
    async render() {
      const relationships = await Api.get('/di/relationships');
      const canCreate = Session.can('relationships:create');
      const canUpdate = Session.can('relationships:update');
      return html`
        <div class="page">
          ${UI.pageHeader('Relationships', 'Brokers, landowners, sellers, municipalities and partners who source opportunities')}
          ${canCreate ? html`
            <form class="card form-card form-inline" data-form="relationship-create" data-testid="relationship-form" novalidate>
              <div class="form-grid">
                ${UI.field({ name: 'name', label: 'Name', required: true })}
                <label class="field"><span class="lbl">Type</span>
                  <input class="input" name="relationshipType" list="relationship-types" required placeholder="e.g. broker">
                  <datalist id="relationship-types">${RELATIONSHIP_TYPES.map(t => html`<option value="${t}"></option>`)}</datalist>
                </label>
              </div>
              ${provenanceFields()}
              ${UI.formError()}
              <div class="form-actions"><button class="btn btn-navy btn-sm" type="submit">Add relationship</button></div>
            </form>` : ''}
          ${UI.table([
            { label: 'Name', cell: r => html`<span class="cell-strong">${r.name}</span>` },
            { label: 'Type', cell: r => UI.titleCase(r.relationshipType) },
            { label: 'Status', cell: r => UI.badge(UI.titleCase(r.status.toLowerCase()), r.status === 'ACTIVE' ? 'green' : 'navy') },
            { label: 'Source', cell: r => sourceLabel(r.provenance.sourceType), className: 'cell-dim' },
            { label: '', cell: r => (canUpdate ? html`<button class="btn btn-o btn-sm" data-action="relationship-status" data-id="${r.id}" data-status="${r.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'}">${r.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}</button>` : '') },
          ], relationships, { empty: 'No relationships recorded yet.', rowAttrs: r => html`data-testid="relationship-row"` })}
        </div>`;
    },
  };

  Actions.onSubmit('relationship-create', async form => {
    const name = form.name.value.trim();
    const relationshipType = form.relationshipType.value.trim();
    const created = await UI.submit(form, () => {
      if (!name || !relationshipType) throw new Error('Name and type are required.');
      return Api.post('/di/relationships', { name, relationshipType, provenance: readProvenance(form) });
    });
    if (!created) return;
    UI.toast('Relationship added', 'success');
    App.rerender();
  });

  Actions.onClick('relationship-status', async el => {
    el.disabled = true;
    await Api.patch(`/di/relationships/${encodeURIComponent(el.dataset.id)}`, { status: el.dataset.status });
    App.rerender();
  });

  // ── Findings ─────────────────────────────────
  Pages.findings = {
    title: () => 'Findings',
    async render(ctx) {
      const state = ['ACTIVE', 'OPEN', 'ACKNOWLEDGED', 'RESOLVED'].includes(ctx.query.state) ? ctx.query.state : 'ACTIVE';
      const list = await Api.get(`/di/findings?state=${state}`);
      const tab = (s, label) => html`<a class="chip ${s === state ? 'on' : ''}" href="#${DI}/findings?state=${s}">${label}</a>`;
      return html`
        <div class="page">
          ${UI.pageHeader('Findings', 'Deterministic rule findings over your execution and intelligence data, with an auditable lifecycle',
            Session.can('findings:evaluate') ? html`<button class="btn btn-navy btn-sm" data-action="run-evaluation" data-testid="run-evaluation">Run evaluation now</button>` : '')}
          <div class="chip-row">${tab('ACTIVE', 'Active')}${tab('OPEN', 'Open')}${tab('ACKNOWLEDGED', 'Acknowledged')}${tab('RESOLVED', 'Resolved')}</div>
          ${list.length ? list.map(f => html`
            <article class="card finding" data-testid="finding">
              <div class="finding-head">
                ${UI.badge(UI.titleCase(f.severity), SEVERITY_KIND[f.severity] || 'navy')}
                ${UI.badge(UI.titleCase(f.state.toLowerCase()), FINDING_STATE_KIND[f.state] || 'navy')}
                <span class="cell-dim mono">${f.ruleId} v${f.ruleVersion} · first detected ${UI.date(f.firstDetectedAt)}</span>
              </div>
              <h3 class="finding-title">${f.title}</h3>
              <p class="prose">${f.explanation}</p>
              ${f.resolution ? html`<p class="cell-dim">Resolution: ${f.resolution}</p>` : ''}
              ${f.state !== 'RESOLVED' && (Session.can('findings:acknowledge') || Session.can('findings:resolve')) ? html`
                <form class="finding-actions" data-form="finding-move" data-id="${f.id}" novalidate>
                  <label class="field grow"><span class="sr-only">Note</span><input class="input" name="note" placeholder="Note (required to resolve)"></label>
                  ${f.state === 'OPEN' && Session.can('findings:acknowledge') ? html`<button class="btn btn-o btn-sm" type="submit" name="move" value="acknowledge">Acknowledge</button>` : ''}
                  ${Session.can('findings:resolve') ? html`<button class="btn btn-navy btn-sm" type="submit" name="move" value="resolve">Resolve</button>` : ''}
                  ${UI.formError()}
                </form>` : ''}
            </article>`) : UI.empty(state === 'RESOLVED' ? 'No resolved findings.' : 'No findings in this state. Run an evaluation to check current data.')}
        </div>`;
    },
  };

  Actions.onClick('run-evaluation', async el => {
    el.disabled = true;
    try {
      const result = await Api.post('/di/evaluate', { asOf: new Date().toISOString() });
      const n = result && Array.isArray(result.findings) ? result.findings.length : null;
      UI.toast(n === null ? 'Evaluation complete' : `Evaluation complete: ${n} active finding${n === 1 ? '' : 's'}`, 'success');
      App.rerender();
    } finally {
      el.disabled = false;
    }
  });

  Actions.onSubmit('finding-move', async (form, event) => {
    const move = event.submitter && event.submitter.value;
    const note = form.note.value.trim();
    const done = await UI.submit(form, () => {
      if (move === 'resolve' && !note) throw new Error('A note is required to resolve a finding.');
      return Api.post(`/di/findings/${encodeURIComponent(form.dataset.id)}/${move === 'resolve' ? 'resolve' : 'acknowledge'}`, note ? { note } : {});
    });
    if (!done) return;
    UI.toast(move === 'resolve' ? 'Finding resolved' : 'Finding acknowledged', 'success');
    App.rerender();
  });
})(window);
