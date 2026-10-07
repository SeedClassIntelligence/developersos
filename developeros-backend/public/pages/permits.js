// ═══════════════════════════════════════════════
// PERMITS.JS — renderPermits()
// TODO: GET /api/v1/permits?projectId=:id
// ═══════════════════════════════════════════════

function renderPermits() {
  const app = document.getElementById('app');
  const proj = currentProject();
  const permits = state.permits.filter(p => p.projectId === proj?.id);

  const statusLabel  = { 'approved':'Approved','under-review':'Under Review','corrections':'Corrections Open','draft':'Draft','submitted':'Submitted' };
  const statusBadge  = { 'approved':'badge-green','under-review':'badge-blue','corrections':'badge-red','draft':'badge-navy','submitted':'badge-blue' };

  const approved     = permits.filter(p => p.status === 'approved').length;
  const underReview  = permits.filter(p => p.status === 'under-review').length;
  const corrections  = permits.filter(p => p.status === 'corrections').length;

  const correctionPermit = permits.find(p => p.status === 'corrections');

  app.innerHTML = `
    <div style="padding:28px 32px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
        <div><div class="panel-h">Permit Tracker</div><div class="panel-sub">All permits tracked from submission through approval — corrections become tasks</div></div>
        <button class="btn btn-navy btn-sm" onclick="alert('Add permit — connect to POST /api/v1/permits')">+ Add Permit</button>
      </div>

      <div class="grid-4" style="margin-bottom:24px">
        <div class="stat-box"><div class="stat-n" style="color:var(--green)">${approved}</div><div class="stat-l">Approved</div></div>
        <div class="stat-box"><div class="stat-n" style="color:var(--blue)">${underReview}</div><div class="stat-l">Under Review</div></div>
        <div class="stat-box"><div class="stat-n" style="color:var(--red)">${corrections}</div><div class="stat-l">Corrections Open</div></div>
        <div class="stat-box"><div class="stat-n">${permits.length}</div><div class="stat-l">Total Permits</div></div>
      </div>

      <div style="background:var(--bg2);border:1px solid var(--bd);border-radius:10px;overflow:hidden">
        <table class="tbl">
          <thead><tr><th>Permit Name</th><th>Jurisdiction</th><th>Type</th><th>Status</th><th>Submitted</th><th></th></tr></thead>
          <tbody>
            ${permits.map(pm => `
              <tr onclick="togglePermitDetail('${pm.id}')" style="cursor:pointer;${pm.status==='corrections'?'background:rgba(196,122,42,.02)':''}">
                <td>${pm.name}</td>
                <td style="font-size:11px;color:var(--mu)">${pm.jurisdiction}</td>
                <td><span class="badge badge-navy" style="font-size:8.5px">${pm.type}</span></td>
                <td><span class="badge ${statusBadge[pm.status]||'badge-navy'}">${statusLabel[pm.status]||pm.status}</span></td>
                <td class="mono" style="font-size:11px">${pm.submittedDate || '—'}${pm.status==='corrections'?' ⚠':''}</td>
                <td>
                  ${pm.status === 'corrections'
                    ? `<button class="btn btn-gold btn-sm" style="font-size:10px" onclick="event.stopPropagation();togglePermitDetail('${pm.id}')">Respond</button>`
                    : `<button class="btn btn-o btn-sm" style="font-size:10px" onclick="event.stopPropagation();togglePermitDetail('${pm.id}')">View</button>`
                  }
                </td>
              </tr>
              <tr id="detail-permit-${pm.id}" style="display:none">
                <td colspan="6" style="padding:0">
                  <div style="padding:16px 20px;background:var(--bg3);border-top:1px solid var(--bd)">
                    ${pm.corrections.length > 0 ? `
                      <div style="font-size:11px;font-weight:600;color:var(--gd);letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px">Correction Items</div>
                      ${pm.corrections.map((cor,i) => `
                        <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;padding:8px 0;border-bottom:1px solid var(--bd)">
                          <span style="color:var(--mu)">${i+1}. ${cor.text}</span>
                          <span class="badge ${cor.status==='in-progress'?'badge-amber':'badge-red'}">${cor.status==='in-progress'?'In Progress':'Not Started'}</span>
                        </div>
                      `).join('')}
                    ` : `<div style="font-size:12px;color:var(--mu)">No correction items. ${pm.approvedDate ? `Approved: ${pm.approvedDate}` : 'Under review.'}</div>`}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function togglePermitDetail(id) {
  const row = document.getElementById(`detail-permit-${id}`);
  if (row) row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
}
