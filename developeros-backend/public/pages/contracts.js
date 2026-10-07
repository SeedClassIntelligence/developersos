// ═══════════════════════════════════════════════
// CONTRACTS.JS — renderContracts()
// TODO: GET /api/v1/contracts?projectId=:id
// ═══════════════════════════════════════════════

function renderContracts() {
  const app = document.getElementById('app');
  const proj = currentProject();
  const contracts = state.contracts.filter(c => c.projectId === (proj?.id));
  const executed = contracts.filter(c => c.status === 'executed').length;
  const missing  = contracts.filter(c => c.status === 'missing').length;
  const pending  = contracts.filter(c => c.status === 'pending').length;

  app.innerHTML = `
    <div style="padding:28px 32px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
        <div><div class="panel-h">Contracts</div><div class="panel-sub">Contract status cross-referenced with SOW tasks — no task proceeds without coverage</div></div>
        <button class="btn btn-navy btn-sm" onclick="alert('Upload contract — connect to POST /api/v1/contracts')">+ Upload Contract</button>
      </div>

      <div class="grid-4" style="margin-bottom:24px">
        <div class="stat-box"><div class="stat-n" style="color:var(--green)">${executed}</div><div class="stat-l">Executed</div></div>
        <div class="stat-box"><div class="stat-n" style="color:var(--red)">${missing}</div><div class="stat-l">Missing</div></div>
        <div class="stat-box"><div class="stat-n" style="color:var(--amber)">${pending}</div><div class="stat-l">Pending Signature</div></div>
        <div class="stat-box"><div class="stat-n">${contracts.length}</div><div class="stat-l">Total Contracts</div></div>
      </div>

      <div style="background:var(--bg2);border:1px solid var(--bd);border-radius:10px;overflow:hidden">
        <table class="tbl">
          <thead><tr><th>Partner / Entity</th><th>Role</th><th>Contract Type</th><th>Status</th><th>Linked Tasks</th><th>Action</th></tr></thead>
          <tbody>
            ${contracts.map(c => {
              const partner = (state.partners || []).find(p => p.id === c.partnerId);
              const pName = partner?.name || c.partnerId;
              const pRole = partner?.role || '—';
              const isGood = c.status === 'executed';
              const isBad  = c.status === 'missing';
              return `
                <tr onclick="toggleContractDetail('${c.id}')" style="cursor:pointer">
                  <td>${pName}</td>
                  <td>${roleBadge(pRole)}</td>
                  <td style="font-size:12px">${c.type}</td>
                  <td>
                    <span class="badge ${isGood?'badge-green':isBad?'badge-red':'badge-amber'}">
                      ${isGood?'✓ Executed':isBad?'❌ Missing':'⏳ Pending'}
                    </span>
                  </td>
                  <td style="font-size:12px;color:var(--mu)">${c.linkedTaskCount} task${c.linkedTaskCount!==1?'s':''}</td>
                  <td>
                    ${isBad
                      ? `<button class="btn btn-gold btn-sm" style="font-size:10px" onclick="event.stopPropagation();alert('Execute contract — connect to POST /api/v1/contracts/${c.id}/execute')">Execute Now</button>`
                      : `<button class="btn btn-o btn-sm" style="font-size:10px" onclick="event.stopPropagation();toggleContractDetail('${c.id}')">View</button>`
                    }
                  </td>
                </tr>
                <tr id="detail-${c.id}" style="display:none">
                  <td colspan="6" style="padding:0">
                    <div style="padding:16px 20px;background:var(--bg3);border-top:1px solid var(--bd)">
                      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;font-size:12px">
                        <div><div class="lbl">Type</div><div style="color:var(--navy)">${c.type}</div></div>
                        <div><div class="lbl">Status</div><span class="badge ${isGood?'badge-green':isBad?'badge-red':'badge-amber'}">${c.status}</span></div>
                        <div><div class="lbl">Value</div><div style="color:var(--navy)">${c.value ? fmt(c.value) : '—'}</div></div>
                        <div><div class="lbl">Executed</div><div style="color:var(--navy)">${c.executedDate || '—'}</div></div>
                      </div>
                      ${isBad ? `<div style="margin-top:12px;font-size:12px;color:var(--red)">⚠ This missing contract is blocking ${c.linkedTaskCount} task${c.linkedTaskCount!==1?'s':''}. Execute immediately to unblock workflow.</div>` : ''}
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function toggleContractDetail(id) {
  const row = document.getElementById(`detail-${id}`);
  if (row) row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
}
