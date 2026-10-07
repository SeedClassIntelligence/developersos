// ═══════════════════════════════════════════════
// MOCKDATA.JS — Realistic seed data
// Replace each section with API fetch() calls
// when backend is ready.
// ═══════════════════════════════════════════════

// ── CURRENT USER ──────────────────────────────
state.currentUser = {
  id: 'u1',
  name: 'Maria Rodriguez',
  initials: 'MR',
  email: 'maria@kgdevelopment.com',
  role: 'developer',
  organization: 'KG Development',
};
state.isAuthenticated = false; // false = show landing

// ── PROJECTS ──────────────────────────────────
state.projects = [
  {
    id: 'p1',
    name: 'Westside Housing Phase II',
    type: 'Affordable Housing',
    units: 120,
    affordableUnits: 72,
    budget: 24200000,
    spent: 10890000,
    progress: 45,
    phase: 3, // 1-6
    phaseLabel: 'Design Development',
    status: 'on-track',   // on-track | at-risk | blocked
    alertCount: 3,
    city: 'Los Angeles',
    program: 'LIHTC',
    startDate: '2024-09-01',
    estimatedCompletion: '2026-08-01',
  },
  {
    id: 'p2',
    name: 'Central Commons Mixed-Use',
    type: 'Market Rate',
    units: 220,
    affordableUnits: 0,
    budget: 48000000,
    spent: 13440000,
    progress: 28,
    phase: 2,
    phaseLabel: 'Entitlements',
    status: 'at-risk',
    alertCount: 2,
    city: 'Los Angeles',
    program: 'Market Rate',
    startDate: '2024-11-01',
    estimatedCompletion: '2027-01-01',
  },
  {
    id: 'p3',
    name: 'Veterans Supportive Housing',
    type: 'Supportive Housing',
    units: 68,
    affordableUnits: 68,
    budget: 18000000,
    spent: 2160000,
    progress: 12,
    phase: 1,
    phaseLabel: 'Predevelopment',
    status: 'blocked',
    alertCount: 5,
    city: 'Los Angeles',
    program: 'HUD VASH',
    startDate: '2025-01-01',
    estimatedCompletion: '2027-06-01',
  },
  {
    id: 'p4',
    name: 'Harbor View Senior Living',
    type: 'Senior Housing',
    units: 88,
    affordableUnits: 44,
    budget: 22000000,
    spent: 15840000,
    progress: 72,
    phase: 5,
    phaseLabel: 'Construction',
    status: 'on-track',
    alertCount: 0,
    city: 'Long Beach',
    program: 'HUD 202',
    startDate: '2023-06-01',
    estimatedCompletion: '2025-09-01',
  },
  {
    id: 'p5',
    name: 'Riverside Workforce Housing',
    type: 'Workforce Housing',
    units: 156,
    affordableUnits: 78,
    budget: 36000000,
    spent: 19800000,
    progress: 55,
    phase: 4,
    phaseLabel: 'Financing',
    status: 'at-risk',
    alertCount: 3,
    city: 'Riverside',
    program: 'HOME + LIHTC',
    startDate: '2024-01-01',
    estimatedCompletion: '2026-03-01',
  },
  {
    id: 'p6',
    name: 'Eastside Community Development',
    type: 'Mixed Income',
    units: 190,
    affordableUnits: 57,
    budget: 52000000,
    spent: 46800000,
    progress: 90,
    phase: 6,
    phaseLabel: 'Stabilization',
    status: 'on-track',
    alertCount: 0,
    city: 'Los Angeles',
    program: 'LIHTC + City',
    startDate: '2022-09-01',
    estimatedCompletion: '2025-04-01',
  },
];
state.currentProjectId = 'p1';

// ── TASKS ──────────────────────────────────────
state.tasks = [
  // p1 — Westside Housing
  { id: 't1',  projectId: 'p1', title: 'Landscape Plan Stamp',         discipline: 'landscape', partnerId: 'part3', contractId: null,   status: 'not-started', dueDate: '2025-03-02', deps: ['t4'], note: 'BLOCKS permit package assembly' },
  { id: 't2',  projectId: 'p1', title: 'MEP Coordination Drawings',    discipline: 'mep',       partnerId: null,    contractId: null,   status: 'not-started', dueDate: '2025-03-05', deps: [],    note: 'No partner assigned' },
  { id: 't3',  projectId: 'p1', title: 'Parking Layout Final',         discipline: 'arch',      partnerId: 'part1', contractId: 'c1',   status: 'not-started', dueDate: '2025-03-10', deps: [],    note: '' },
  { id: 't4',  projectId: 'p1', title: 'Civil Site Plan Rev D',        discipline: 'civil',     partnerId: 'part2', contractId: 'c2',   status: 'in-progress', dueDate: '2025-02-26', deps: [],    note: 'Incorporating planning correction comments' },
  { id: 't5',  projectId: 'p1', title: 'Structural Calc Package',      discipline: 'structural', partnerId: 'part4', contractId: 'c3',  status: 'in-progress', dueDate: '2025-03-01', deps: [],    note: 'Rev C drawings uploaded' },
  { id: 't6',  projectId: 'p1', title: 'Floor Plan Revisions',         discipline: 'arch',      partnerId: 'part1', contractId: 'c1',   status: 'in-progress', dueDate: '2025-02-28', deps: [],    note: '3 correction items outstanding' },
  { id: 't7',  projectId: 'p1', title: 'Final Permit Package Assembly',discipline: 'arch',      partnerId: 'part1', contractId: 'c1',   status: 'blocked',     dueDate: '2025-03-03', deps: ['t1','t2'], note: 'Awaiting landscape stamp + MEP drawings' },
  { id: 't8',  projectId: 'p1', title: 'Grading Plan Resubmittal',     discipline: 'civil',     partnerId: 'part2', contractId: 'c2',   status: 'blocked',     dueDate: '2025-02-26', deps: [],    note: 'Survey correction pending' },
  { id: 't9',  projectId: 'p1', title: 'Zoning Compliance Report',     discipline: 'arch',      partnerId: 'part1', contractId: 'c1',   status: 'complete',    dueDate: '2025-01-15', deps: [],    note: 'Approved by planning' },
  { id: 't10', projectId: 'p1', title: 'Topographic Site Survey',      discipline: 'civil',     partnerId: 'part5', contractId: 'c4',   status: 'complete',    dueDate: '2025-01-10', deps: [],    note: 'Stamped and filed' },
  { id: 't11', projectId: 'p1', title: 'Phase I Environmental',        discipline: 'civil',     partnerId: 'part6', contractId: 'c5',   status: 'complete',    dueDate: '2024-12-20', deps: [],    note: 'No RECs identified' },
  { id: 't12', projectId: 'p1', title: 'Soils Report',                 discipline: 'civil',     partnerId: 'part7', contractId: 'c6',   status: 'complete',    dueDate: '2024-12-15', deps: [],    note: '' },
];

// ── PARTNERS ───────────────────────────────────
state.partners = [
  { id: 'part1', name: 'Arch Studio Inc.',        role: 'architect',    initials: 'AS', contractIds: ['c1'] },
  { id: 'part2', name: 'Smith Civil Engineering', role: 'civil',        initials: 'SC', contractIds: ['c2'] },
  { id: 'part3', name: 'Green Landscape Design',  role: 'landscape',    initials: 'GL', contractIds: [] },
  { id: 'part4', name: 'Torres Structural',        role: 'structural',   initials: 'TS', contractIds: ['c3'] },
  { id: 'part5', name: 'Pacific Survey Co.',       role: 'survey',       initials: 'PS', contractIds: ['c4'] },
  { id: 'part6', name: 'EnviroCheck Inc.',         role: 'environmental',initials: 'EC', contractIds: ['c5'] },
  { id: 'part7', name: 'GeoTech LA',              role: 'geotechnical', initials: 'GT', contractIds: ['c6'] },
  { id: 'part8', name: 'Western Construction GC', role: 'contractor',   initials: 'WC', contractIds: [] },
];

// ── CONTRACTS ─────────────────────────────────
state.contracts = [
  { id: 'c1', projectId: 'p1', partnerId: 'part1', type: 'Prime Architectural Services',  status: 'executed', value: 480000,  executedDate: '2025-01-08', linkedTaskCount: 12 },
  { id: 'c2', projectId: 'p1', partnerId: 'part2', type: 'Civil Engineering Services',    status: 'executed', value: 185000,  executedDate: '2025-01-20', linkedTaskCount: 8 },
  { id: 'c3', projectId: 'p1', partnerId: 'part4', type: 'Structural Engineering',        status: 'executed', value: 120000,  executedDate: '2025-01-15', linkedTaskCount: 6 },
  { id: 'c4', projectId: 'p1', partnerId: 'part5', type: 'Survey Services',               status: 'executed', value: 28000,   executedDate: '2024-12-01', linkedTaskCount: 2 },
  { id: 'c5', projectId: 'p1', partnerId: 'part6', type: 'Phase I Environmental',         status: 'executed', value: 8500,    executedDate: '2024-11-15', linkedTaskCount: 1 },
  { id: 'c6', projectId: 'p1', partnerId: 'part7', type: 'Geotechnical Investigation',    status: 'executed', value: 32000,   executedDate: '2024-11-20', linkedTaskCount: 2 },
  // Missing contracts
  { id: 'c7', projectId: 'p1', partnerId: 'part3', type: 'Landscape Architecture',        status: 'missing',  value: null,    executedDate: null,         linkedTaskCount: 3 },
  { id: 'c8', projectId: 'p1', partnerId: 'part8', type: 'General Contractor Agreement',  status: 'pending',  value: 16800000,executedDate: null,         linkedTaskCount: 22 },
];

// ── PERMITS ────────────────────────────────────
state.permits = [
  {
    id: 'pm1', projectId: 'p1', name: 'Demolition Permit', jurisdiction: 'City of LA — Building',
    type: 'demo', status: 'approved', submittedDate: '2024-12-20', approvedDate: '2025-01-14',
    corrections: [],
  },
  {
    id: 'pm2', projectId: 'p1', name: 'Building Permit — Type V', jurisdiction: 'City of LA — Building',
    type: 'building', status: 'under-review', submittedDate: '2025-01-28', approvedDate: null,
    corrections: [],
  },
  {
    id: 'pm3', projectId: 'p1', name: 'Grading Permit', jurisdiction: 'City of LA — Public Works',
    type: 'grading', status: 'corrections', submittedDate: '2025-01-18', approvedDate: null,
    corrections: [
      { id: 'cor1', text: 'Revise drainage calculations to show 100-yr storm', status: 'in-progress' },
      { id: 'cor2', text: 'Provide soils report addendum for northwest corner', status: 'not-started' },
      { id: 'cor3', text: 'Update cross-sections at Building A footprint', status: 'not-started' },
    ],
  },
  {
    id: 'pm4', projectId: 'p1', name: 'Fire Sprinkler Permit', jurisdiction: 'LAFD',
    type: 'fire', status: 'under-review', submittedDate: '2025-02-02', approvedDate: null,
    corrections: [],
  },
  {
    id: 'pm5', projectId: 'p1', name: 'Landscape Permit', jurisdiction: 'City of LA — Planning',
    type: 'landscape', status: 'draft', submittedDate: null, approvedDate: null,
    corrections: [],
  },
];

// ── CAPITAL STACK ──────────────────────────────
state.capitalStacks = [
  {
    projectId: 'p1',
    totalCost: 24200000,
    sources: [
      { id: 'cap1', name: 'Construction Loan — Western Bank', type: 'debt',    amount: 14000000, pct: 58, status: 'committed', color: '#1A2332' },
      { id: 'cap2', name: 'LIHTC Equity — National Equity Fund', type: 'equity', amount: 5800000, pct: 24, status: 'pending',   color: '#2A7A6A', deadline: '2025-03-15', alert: 'Commitment expires in 45 days' },
      { id: 'cap3', name: 'City Gap Financing — LACDA',       type: 'grant',   amount: 2400000,  pct: 10, status: 'committed', color: '#C4973A' },
      { id: 'cap4', name: 'HOME Investment Grant',             type: 'grant',   amount: 2000000,  pct: 8,  status: 'committed', color: '#3A7A4A' },
    ],
  },
];

// ── CHANNELS & MESSAGES ────────────────────────
state.channels = [
  { id: 'ch1', name: 'westside-general',     projectId: 'p1', desc: 'All project stakeholders', unread: 0 },
  { id: 'ch2', name: 'permits-approvals',    projectId: 'p1', desc: 'Permit coordination',       unread: 2 },
  { id: 'ch3', name: 'design-coordination',  projectId: 'p1', desc: 'Design team channel',       unread: 1 },
  { id: 'ch4', name: 'construction',         projectId: 'p1', desc: 'Field coordination',        unread: 0 },
  { id: 'ch5', name: 'capital-finance',      projectId: 'p1', desc: 'Finance & lenders',         unread: 0 },
];
state.activeChannel = 'ch1';

state.messages = {
  ch1: [
    { id: 'm1', channelId: 'ch1', senderId: 'u1', senderName: 'Maria Rodriguez', senderInitials: 'MR', senderColor: '#2A7A6A', role: 'Developer', text: 'Good morning team — @Anthony we need the grading correction package by Friday.', timestamp: '10:14 AM', mentions: ['Anthony'] },
    { id: 'm2', channelId: 'ch1', senderId: 'u2', senderName: 'Anthony Rivera',  senderInitials: 'AR', senderColor: '#3A6A9A', role: 'Civil Eng.', text: "Got it. Working on the drainage calcs now. The soils addendum is the blocker — waiting on geotechnical to send it today.", timestamp: '10:22 AM', mentions: [] },
    { id: 'm3', channelId: 'ch1', senderId: 'u1', senderName: 'KG Development',  senderInitials: 'KG', senderColor: '#1A2332', role: 'Developer', text: '@Anthony if geo is not responsive today, loop in @Maria and we will escalate directly. Landscape contract also still missing.', timestamp: '10:35 AM', mentions: ['Anthony','Maria'] },
    { id: 'm4', channelId: 'ch1', senderId: 'u3', senderName: 'Maria Chen',       senderInitials: 'MC', senderColor: '#3A7A4A', role: 'Architect', text: "I've reached out to Green Landscape re contract. They can execute by Wednesday. Package assembly is ready once we have landscape stamp and MEP coordination.", timestamp: '11:02 AM', mentions: [] },
  ],
  ch2: [
    { id: 'm5', channelId: 'ch2', senderId: 'u2', senderName: 'Anthony Rivera', senderInitials: 'AR', senderColor: '#3A6A9A', role: 'Civil Eng.', text: 'Grading correction #1 (drainage calcs) is in progress. Submitting Thursday.', timestamp: 'Yesterday', mentions: [] },
    { id: 'm6', channelId: 'ch2', senderId: 'u4', senderName: 'City Planner', senderInitials: 'CP', senderColor: '#6A6860', role: 'Municipal', text: 'Acknowledged. Please include the soils addendum with your resubmittal package.', timestamp: 'Yesterday', mentions: [] },
  ],
};

// ── DOCUMENTS ──────────────────────────────────
state.documents = [
  { id: 'd1',  projectId: 'p1', name: 'Civil Site Plan Rev D',      category: 'plans',     uploadedBy: 'Smith Civil', date: 'Feb 18', type: 'PDF',  icon: '📐' },
  { id: 'd2',  projectId: 'p1', name: 'Building Permit Application',category: 'permits',   uploadedBy: 'Arch Studio', date: 'Jan 28', type: 'PDF',  icon: '🏛️' },
  { id: 'd3',  projectId: 'p1', name: 'Arch Services Contract',     category: 'contracts', uploadedBy: 'KG Dev',      date: 'Jan 8',  type: 'PDF',  icon: '📋' },
  { id: 'd4',  projectId: 'p1', name: 'Phase I Environmental',      category: 'reports',   uploadedBy: 'EnviroCheck', date: 'Dec 12', type: 'PDF',  icon: '🌿' },
  { id: 'd5',  projectId: 'p1', name: 'LIHTC Application',         category: 'reports',   uploadedBy: 'KG Dev',      date: 'Nov 30', type: 'PDF',  icon: '💰' },
  { id: 'd6',  projectId: 'p1', name: 'City MOU — LACDA',          category: 'mous',      uploadedBy: 'KG Dev',      date: 'Oct 15', type: 'PDF',  icon: '🤝' },
  { id: 'd7',  projectId: 'p1', name: 'Pro Forma v4',              category: 'reports',   uploadedBy: 'KG Dev',      date: 'Feb 10', type: 'XLSX', icon: '📊' },
  { id: 'd8',  projectId: 'p1', name: 'Soils Report',              category: 'reports',   uploadedBy: 'GeoTech LA',  date: 'Sep 22', type: 'PDF',  icon: '🏗️' },
];

// ── AI ALERTS ──────────────────────────────────
state.alerts = [
  { id: 'al1', projectId: 'p1', severity: 'critical', title: 'Landscape contract missing — submission in 6 days', desc: 'Landscape Plan Stamp task (SOW #07) cannot proceed. 3 downstream tasks blocked. Submission deadline March 2.', action: 'contracts',    actionLabel: 'Execute Contract' },
  { id: 'al2', projectId: 'p1', severity: 'critical', title: 'MEP scope unassigned — no partner, no contract',    desc: 'MEP Coordination Drawings required before structural final. No partner assigned. 4 tasks blocked.',             action: 'contracts',    actionLabel: 'Assign Partner' },
  { id: 'al3', projectId: 'p1', severity: 'warning',  title: 'Grading permit correction cycle — 14 days open',    desc: 'City corrections received Feb 12. 3 items outstanding. Risk of losing review slot if not responded by Feb 26.',  action: 'permits',      actionLabel: 'View Corrections' },
  { id: 'al4', projectId: 'p1', severity: 'warning',  title: 'LIHTC equity commitment expires in 45 days',        desc: 'National Equity Fund commitment letter expires March 15. Construction loan cannot fund without equity close.',       action: 'capital',      actionLabel: 'Review Capital Stack' },
  { id: 'al5', projectId: 'p1', severity: 'warning',  title: 'GC contract pending — construction start in 60 days',desc: 'Western Construction GC contract still pending. 22 construction tasks cannot begin.',                            action: 'contracts',    actionLabel: 'Follow Up' },
  { id: 'al6', projectId: 'p3', severity: 'info',     title: 'Veterans Housing — City MOU not yet executed',       desc: 'Predevelopment cannot advance without city partnership MOU. Schedule meeting with housing authority.',              action: 'documents',    actionLabel: 'Upload MOU' },
];

// ── TEAM MEMBERS ───────────────────────────────
state.teamMembers = [
  { id: 'tm1', name: 'Maria Rodriguez', role: 'developer',  projects: 'All',              lastActive: 'Today',      status: 'active' },
  { id: 'tm2', name: 'Maria Chen',      role: 'architect',  projects: 'Westside, Central',lastActive: 'Today',      status: 'active' },
  { id: 'tm3', name: 'Anthony Rivera',  role: 'civil',      projects: 'Westside',         lastActive: '2 hrs ago',  status: 'active' },
  { id: 'tm4', name: 'James Torres',    role: 'structural', projects: 'Westside',         lastActive: 'Yesterday',  status: 'active' },
  { id: 'tm5', name: 'City Planner — LA',role: 'municipal', projects: 'Westside',         lastActive: '3 days ago', status: 'readonly' },
  { id: 'tm6', name: 'NEF Capital Partner',role: 'investor',projects: 'Westside',         lastActive: '1 week ago', status: 'finance-view' },
];

// ── ORGANIZATIONS (super admin) ────────────────
state.organizations = [
  { id: 'org1', name: 'KG Development',    type: 'developer',  projects: 6,  users: 12, plan: 'Pro' },
  { id: 'org2', name: 'Pacific Housing',   type: 'developer',  projects: 8,  users: 24, plan: 'Enterprise' },
  { id: 'org3', name: 'City of LA',        type: 'municipal',  projects: 15, users: 6,  plan: 'Gov' },
  { id: 'org4', name: 'Westside CDC',      type: 'nonprofit',  projects: 3,  users: 8,  plan: 'Pro' },
];
