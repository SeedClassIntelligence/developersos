// ═══════════════════════════════════════════════
// LANDING.JS — Marketing landing page
// ═══════════════════════════════════════════════

function renderLanding() {
  const el = document.getElementById('landing-page');
  if (!el) return;
  el.style.display = 'block';

  el.innerHTML = `
    <!-- Nav -->
    <nav class="l-nav">
      <div class="l-logo"><span class="ldot"></span>DeveloperOS</div>
      <div class="l-nav-links">
        <span class="l-nl" onclick="document.getElementById('features').scrollIntoView({behavior:'smooth'})">Features</span>
        <span class="l-nl" onclick="document.getElementById('how').scrollIntoView({behavior:'smooth'})">How It Works</span>
        <span class="l-nl" onclick="document.getElementById('roles').scrollIntoView({behavior:'smooth'})">Roles</span>
      </div>
      <div class="l-nav-right">
        <span class="l-signin" onclick="enterApp()">Sign In</span>
        <button class="btn btn-navy btn-sm" onclick="enterApp()">Enter Platform →</button>
      </div>
    </nav>

    <!-- Hero -->
    <section class="l-hero" id="top">
      <div class="l-ey">Real Estate Development Platform</div>
      <h1 class="l-h">The <em>operating system</em><br>for real estate development.</h1>
      <p class="l-sub">From deal intake through stabilized asset management — DeveloperOS unifies every stakeholder, document, permit, and decision into one coordinated platform.</p>
      <div class="l-actions">
        <button class="btn btn-gold" onclick="enterApp()" style="font-size:14px;padding:13px 30px">Enter Platform →</button>
        <button class="btn btn-o" onclick="document.getElementById('features').scrollIntoView({behavior:'smooth'})">See Features</button>
      </div>
      <div class="l-stats">
        <div><div class="ls-n">8</div><div class="ls-l">Dev Phases</div></div>
        <div><div class="ls-n">6</div><div class="ls-l">User Roles</div></div>
        <div><div class="ls-n">AI</div><div class="ls-l">Risk Intelligence</div></div>
        <div><div class="ls-n">∞</div><div class="ls-l">Projects</div></div>
      </div>
    </section>

    <!-- Features -->
    <section class="l-section" id="features">
      <div class="eyebrow">Core Platform Capabilities</div>
      <h2 class="sh-head">One system. <em>Every stakeholder.</em></h2>
      <p class="sub" style="max-width:580px;margin-bottom:0">Eliminates coordination failures across municipalities, architects, contractors, lenders, and service providers.</p>
      <div class="feat-grid">
        ${[
          ['📋','SOW Execution Engine','Convert scope documents into live, trackable tasks with assigned partners, contracts, and dependencies.'],
          ['🏛️','Permit Tracker','Track every permit from submission through approval. City comments become tasks automatically.'],
          ['⚠️','AI Risk Alerts','Automated intelligence flags missing contracts, permit delays, and financing gaps before they become critical.'],
          ['💬','In-Platform Messaging','Every conversation tied to a task, project, or document. No more email threads.'],
          ['💰','Capital Stack Builder','Model your full capital structure — debt, equity, LIHTC, grants, city gap — with live tracking.'],
          ['📐','Contract Alignment','Every SOW task cross-referenced with executed contracts. No work proceeds without coverage.'],
          ['🏘️','Affordable Housing','LIHTC, HOME, CDBG, and supportive housing workflows built in with AMI tracking.'],
          ['🌐','Municipal Portal','City planners access project summaries, plans, and compliance data directly.'],
        ].map(([icon,name,desc]) => `
          <div class="feat">
            <span class="feat-icon">${icon}</span>
            <div class="feat-name">${name}</div>
            <div class="feat-desc">${desc}</div>
          </div>
        `).join('')}
      </div>
    </section>

    <!-- How it works -->
    <section class="l-section" id="how">
      <div class="eyebrow">The Process</div>
      <h2 class="sh-head">From deal to <em>stabilized asset.</em></h2>
      <p class="sub" style="max-width:560px;margin-bottom:0">The user never switches systems — the project simply evolves through phases inside the same interface.</p>
      <div class="how-grid">
        ${[
          ['01','Intake & Feasibility','Capture the opportunity, assess feasibility, classify for proceed/hold/reject.'],
          ['02','Entitlements & Design','Assign design team, coordinate revisions, submit permits. AI flags every contract gap.'],
          ['03','Finance & Close','Build capital stack, track commitments, execute loan and equity closings.'],
          ['04','Build & Stabilize','Manage construction, track milestones, coordinate inspections, lease-up, and operations.'],
        ].map(([n,title,desc]) => `
          <div class="how-step">
            <div class="how-num">${n}</div>
            <div class="how-title">${title}</div>
            <div class="how-desc">${desc}</div>
          </div>
        `).join('')}
      </div>
    </section>

    <!-- Roles -->
    <section class="l-section" id="roles">
      <div class="eyebrow">Six User Roles</div>
      <h2 class="sh-head">Built for every stakeholder<br>in the <em>development ecosystem.</em></h2>
      <div class="roles-grid">
        ${[
          ['🏗️','Developer','Full control — portfolio, capital, partners, permits, and AI risk management.'],
          ['🏛️','City / Municipal','Review plans, approve submissions, track compliance without relying on email.'],
          ['📐','Architect / Engineer','Assigned SOW tasks, plan revision tracking, permit comment responses.'],
          ['🔨','Contractor','Construction schedule, RFI/submittal tracker, task sequencing.'],
          ['💰','Lender / Investor','Financial dashboard, draw schedule, covenant compliance, document vault.'],
          ['🤝','Service Provider','Service plan dashboard, program metrics for supportive housing.'],
        ].map(([icon,name,desc]) => `
          <div class="role-card">
            <div class="role-icon">${icon}</div>
            <div class="role-name">${name}</div>
            <div class="role-desc">${desc}</div>
          </div>
        `).join('')}
      </div>
    </section>

    <!-- CTA -->
    <div class="l-cta">
      <div class="eyebrow" style="text-align:center">Get Started</div>
      <h2 class="sh-head" style="text-align:center;margin-bottom:16px">Your projects deserve<br>an <em>operating system.</em></h2>
      <p class="sub" style="text-align:center;margin:0 auto 36px;max-width:480px">Stop coordinating by email. Stop losing decisions. Stop missing contracts before submission.</p>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
        <button class="btn btn-gold" style="font-size:14px;padding:13px 32px" onclick="enterApp()">Enter Platform →</button>
      </div>
    </div>

    <footer class="l-footer">
      <div class="f-brand">DeveloperOS — Real Estate Development Platform</div>
      <div class="f-links">
        <span class="f-l">Features</span>
        <span class="f-l">Roles</span>
        <span class="f-l">About</span>
      </div>
      <div style="font-size:10px;color:var(--dim);font-family:var(--mono)">v1.0 · MVP</div>
    </footer>
  `;
}
