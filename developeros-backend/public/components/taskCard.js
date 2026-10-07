// ═══════════════════════════════════════════════
// TASKCARD.JS — Reusable task card component
// ═══════════════════════════════════════════════

function renderTaskCard(task) {
  const cs = contractStatus(task.contractId);
  const partner = partnerName(task.partnerId);
  const initials = partnerInitials(task.partnerId);
  const isBlocked = task.status === 'blocked';

  return `
    <div class="task-card ${isBlocked ? 'blocked' : ''}" onclick="openTaskModal('${task.id}')">
      <div style="margin-bottom:8px">${disciplineTag(task.discipline)}</div>
      <div class="tc-title">${task.title}</div>
      ${task.note ? `<div style="font-size:10.5px;color:var(--mu);margin-top:4px;line-height:1.4">${task.note}</div>` : ''}
      ${isBlocked && task.deps?.length ? `
        <div style="margin-top:8px;font-size:10px;color:var(--red);background:rgba(168,74,58,.06);padding:5px 8px;border-radius:4px">
          ⊗ Blocked: ${task.deps.length} dependency${task.deps.length>1?'s':''}
        </div>
      ` : ''}
      <div class="tc-meta">
        <div class="tc-assignee">
          <div class="tc-avatar" style="${!task.partnerId?'background:var(--dim2)':''}">
            ${initials}
          </div>
          ${partner}
        </div>
        <div class="tc-contract ${cs.ok ? 'ok' : 'missing'}">
          ${cs.ok ? '✓' : '❌'} ${cs.ok ? 'Contract' : 'No Contract'}
        </div>
      </div>
    </div>
  `;
}
