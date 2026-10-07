// ═══════════════════════════════════════════════
// MODAL.JS — Task detail modal
// ═══════════════════════════════════════════════

function openTaskModal(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;

  state.activeTaskId = taskId;
  state.taskModalOpen = true;

  const cs = contractStatus(task.contractId);
  const partner = partnerName(task.partnerId);
  const initials = partnerInitials(task.partnerId);

  const statusOptions = ['not-started','in-progress','blocked','complete'];
  const statusLabels  = { 'not-started':'⬡ Not Started','in-progress':'◈ In Progress','blocked':'⊗ Blocked','complete':'✓ Complete' };

  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop open" id="task-modal-backdrop" onclick="closeTaskModalOnBack(event)">
      <div class="task-modal">
        <div class="tm-header">
          <div>
            <div class="tm-title">${task.title}</div>
            <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
              ${disciplineTag(task.discipline)}
              <span class="badge ${cs.badge}">${cs.label}</span>
              ${task.dueDate ? `<span class="badge badge-navy" style="font-size:9px">Due ${task.dueDate}</span>` : ''}
            </div>
          </div>
          <button class="tm-close" onclick="closeTaskModal()">✕</button>
        </div>

        <div class="tm-body">
          <!-- LEFT: main content -->
          <div class="tm-main">
            ${task.note ? `
              <div class="tm-section">
                <div class="tm-sh">Description</div>
                <div class="tm-desc">${task.note || 'No description provided.'}</div>
              </div>
            ` : ''}

            <div class="tm-section">
              <div class="tm-sh">Assigned Partner</div>
              <div style="display:flex;align-items:center;gap:10px;font-size:13px;color:var(--navy)">
                <div class="tc-avatar" style="width:28px;height:28px;font-size:10px;${!task.partnerId?'background:var(--dim2)':''}">${initials}</div>
                <span>${partner}</span>
              </div>
            </div>

            ${task.deps && task.deps.length > 0 ? `
              <div class="tm-section">
                <div class="tm-sh">Dependencies</div>
                ${task.deps.map(depId => {
                  const dep = state.tasks.find(t => t.id === depId);
                  return dep ? `<div style="padding:6px 0;border-bottom:1px solid var(--bd);font-size:11.5px;color:var(--mu)">← Requires: ${dep.title}</div>` : '';
                }).join('')}
                <div style="padding:6px 0;font-size:11.5px;color:var(--mu)">→ Blocks: Final Permit Package Assembly</div>
              </div>
            ` : ''}

            <div class="tm-section">
              <div class="tm-sh">Files & Documents</div>
              <div class="file-zone" onclick="alert('File upload — connect to /api/v1/files in backend')">
                📎 Drop files here or click to upload
              </div>
            </div>

            <div class="tm-section">
              <div class="tm-sh">Messages — Tied to This Task</div>
              <div class="chat-messages" id="task-chat-messages">
                <div class="chat-msg them">
                  <div class="msg-name">KG Development</div>
                  We need this executed before the submission deadline.
                </div>
                <div class="chat-msg me">
                  <div class="msg-name">${partner}</div>
                  Understood. Working on it now.
                </div>
              </div>
              <div class="chat-input-row">
                <input type="text" id="task-msg-input" placeholder="Add a message tied to this task…" onkeydown="if(event.key==='Enter')sendTaskMessage()">
                <button class="chat-send" onclick="sendTaskMessage()">→</button>
              </div>
            </div>
          </div>

          <!-- RIGHT: sidebar -->
          <div class="tm-sidebar">
            <div class="tm-sh">Status</div>
            <div class="status-btns" id="status-btns">
              ${statusOptions.map(s => `
                <button class="status-btn ${task.status === s ? 'on' : ''}"
                  onclick="setTaskStatus('${taskId}','${s}')">
                  ${statusLabels[s]}
                </button>
              `).join('')}
            </div>

            <div class="tm-sh" style="margin-top:20px">Contract</div>
            <div id="modal-contract-status">
              ${cs.ok
                ? `<div style="font-size:12px;color:var(--green);background:rgba(58,122,74,.06);border:1px solid rgba(58,122,74,.2);border-radius:6px;padding:10px 12px">✓ Contract executed and on file.</div>`
                : `<div style="font-size:12px;color:var(--red);background:rgba(168,74,58,.06);border:1px solid rgba(168,74,58,.2);border-radius:6px;padding:10px 12px">
                    ❌ No executed contract found.<br><br>
                    <button class="btn btn-gold btn-sm" style="width:100%;justify-content:center;margin-top:4px" onclick="navigate('contracts');closeTaskModal()">Execute Contract →</button>
                  </div>`
              }
            </div>

            <div class="tm-sh" style="margin-top:20px">Due Date</div>
            <input class="input" type="date" value="${task.dueDate || ''}" style="font-size:12px">

            <button class="btn btn-navy" style="width:100%;justify-content:center;margin-top:20px;font-size:12px" onclick="saveTaskChanges('${taskId}')">
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function closeTaskModal() {
  state.taskModalOpen = false;
  state.activeTaskId = null;
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
}

function closeTaskModalOnBack(e) {
  if (e.target.id === 'task-modal-backdrop') closeTaskModal();
}

function setTaskStatus(taskId, newStatus) {
  updateTaskStatus(taskId, newStatus);
  // Update buttons in modal
  document.querySelectorAll('.status-btn').forEach(btn => btn.classList.remove('on'));
  event.target.classList.add('on');
}

function sendTaskMessage() {
  const input = document.getElementById('task-msg-input');
  if (!input || !input.value.trim()) return;
  const msgs = document.getElementById('task-chat-messages');
  if (msgs) {
    const div = document.createElement('div');
    div.className = 'chat-msg me';
    div.innerHTML = `<div class="msg-name">${state.currentUser?.name || 'You'}</div>${input.value}`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }
  input.value = '';
}

function saveTaskChanges(taskId) {
  // TODO: POST /api/v1/tasks/:id
  closeTaskModal();
}
