// ═══════════════════════════════════════════════
// MESSAGES.JS — renderMessages()
// TODO: GET /api/v1/channels, /api/v1/messages
// ═══════════════════════════════════════════════

function renderMessages() {
  const app = document.getElementById('app');
  app.style.padding = '0';
  app.innerHTML = `
    <div class="msg-layout">
      <!-- Channels -->
      <div class="msg-channels">
        <div class="ch-section">Project Channels</div>
        ${state.channels.map(ch => `
          <div class="ch-item ${state.activeChannel===ch.id?'on':''}" onclick="switchChannel('${ch.id}')">
            <span class="ch-hash">#</span>${ch.name}
            ${ch.unread > 0 ? `<span class="ch-unread">${ch.unread}</span>` : ''}
          </div>
        `).join('')}
        <div class="ch-section">Direct</div>
        ${(state.teamMembers||[]).slice(0,3).map(m => `
          <div class="ch-item" onclick="alert('Direct messages — connect to /api/v1/messages/direct')">
            <span style="font-size:12px;color:var(--green)">●</span>${m.name.split(' ')[0]} ${m.name.split(' ')[1]?.[0]||''}.
          </div>
        `).join('')}
      </div>

      <!-- Chat window -->
      <div class="msg-main">
        <div class="msg-topbar">
          <span style="font-size:16px">#</span>
          <div>
            <div class="msg-ch-name" id="ch-display-name">${getActiveChannel()?.name || ''}</div>
            <div class="msg-ch-desc">${getActiveChannel()?.desc || ''}</div>
          </div>
          <div style="margin-left:auto;display:flex;gap:8px">
            <button class="btn btn-o btn-sm">🔗 Link to Task</button>
          </div>
        </div>

        <div class="msg-messages" id="msg-window">
          ${renderMessageList(state.activeChannel)}
        </div>

        <div class="msg-input-area">
          <div style="font-size:10px;color:var(--dim);margin-bottom:6px">💬 Messages are tied to this project channel</div>
          <div class="msg-input-row">
            <button class="msg-attach">📎</button>
            <textarea class="msg-textarea" id="msg-input" placeholder="Message #${getActiveChannel()?.name||'channel'}… use @name to mention someone" rows="1" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendMessage()}"></textarea>
            <button class="msg-send" onclick="sendMessage()">→</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function getActiveChannel() {
  return state.channels.find(c => c.id === state.activeChannel) || state.channels[0];
}

function renderMessageList(channelId) {
  const msgs = state.messages[channelId] || [];
  if (msgs.length === 0) return `<div style="text-align:center;color:var(--dim);padding:40px;font-size:13px">No messages yet. Start the conversation.</div>`;
  return msgs.map(m => `
    <div class="msg-row">
      <div class="msg-av" style="background:${m.senderColor||'var(--navy)'}">${m.senderInitials}</div>
      <div class="msg-content">
        <div class="msg-header">
          <span class="msg-name">${m.senderName}</span>
          <span class="msg-time">${m.timestamp}</span>
          <span class="badge badge-gold" style="font-size:8px">${m.role}</span>
        </div>
        <div class="msg-bubble">${highlightMentions(m.text)}</div>
      </div>
    </div>
  `).join('');
}

function highlightMentions(text) {
  return text.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
}

function switchChannel(channelId) {
  state.activeChannel = channelId;
  // Clear unread
  const ch = state.channels.find(c => c.id === channelId);
  if (ch) ch.unread = 0;
  renderMessages();
  renderSidebar();
}

function sendMessage() {
  const input = document.getElementById('msg-input');
  if (!input || !input.value.trim()) return;

  const ch = state.activeChannel;
  if (!state.messages[ch]) state.messages[ch] = [];

  const newMsg = {
    id: 'm' + Date.now(),
    channelId: ch,
    senderId: state.currentUser?.id,
    senderName: state.currentUser?.name || 'You',
    senderInitials: state.currentUser?.initials || 'U',
    senderColor: '#1A2332',
    role: state.currentUser?.role || 'developer',
    text: input.value,
    timestamp: new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),
    mentions: [],
  };
  state.messages[ch].push(newMsg);

  const win = document.getElementById('msg-window');
  if (win) {
    win.innerHTML = renderMessageList(ch);
    win.scrollTop = win.scrollHeight;
  }
  input.value = '';
  // TODO: POST /api/v1/messages
}
