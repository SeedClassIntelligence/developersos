// ══════════════════════════════════════════════════════════════
// DeveloperOS Test Suite Master Runner
// Controls execution of Regression, Golden Path, Security, and Phase Acceptance
// ══════════════════════════════════════════════════════════════

require('./test-env'); // MUST be first: redirects DATABASE_URL to the isolated *_test database
const { runCleanDatabaseGate } = require('./devos-clean-db-gate.test');
const { runRegressionSuite } = require('./devos-v1-regression.test');
const { runGoldenPath } = require('./devos-golden-001.test');
const { runSecurityDebtSuite } = require('./devos-sec-known-debt.test');
const { runEF1AcceptanceSuite } = require('./devos-ef1-acceptance.test');
const { runEF2AcceptanceSuite } = require('./devos-ef2-acceptance.test');
const { runGoldenSecurityPath } = require('./devos-golden-sec-001.test');
const { runEF3AcceptanceSuite } = require('./devos-ef3-acceptance.test');
const { runDI1AcceptanceSuite } = require('./devos-di1-acceptance.test');
const DI1_BASELINE = require('./fixtures/di1-red-baseline.json');

// DI-1 is gated against its recorded baseline: every test must be in the state
// the baseline records. An unexpected GREEN, an unexpected RED (regression) or a
// test missing from either side fails the gate. Implementation flips entries
// to GREEN as capabilities land; nothing drifts silently.
function compareDI1Baseline(res) {
  const expected = DI1_BASELINE.tests;
  const seen = new Set();
  const unexpectedGreen = [];
  const unexpectedRed = [];
  for (const r of res.results) {
    seen.add(r.id);
    const want = expected[r.id] && expected[r.id].expected;
    if (!want) unexpectedRed.push(`${r.id} (not in baseline)`);
    else if (want === 'RED' && r.passed) unexpectedGreen.push(r.id);
    else if (want === 'GREEN' && !r.passed) unexpectedRed.push(r.id);
  }
  const notRun = Object.keys(expected).filter(id => !seen.has(id));
  return { unexpectedGreen, unexpectedRed, notRun, mismatches: unexpectedGreen.length + unexpectedRed.length + notRun.length };
}
const { stopTestServer } = require('./helpers');

async function main() {
  const target = process.argv[2] || 'all';

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║       DEVELOPEROS GATED TEST HARNESS — MASTER RUNNER         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  let cleanDbRes = null;
  let regressionRes = null;
  let goldenRes = null;
  let securityRes = null;
  let ef1Res = null;
  let ef2Res = null;
  let goldenSecurityRes = null;
  let ef3Res = null;
  let di1Res = null;

  try {
    // Must run first: it is the first caller of ensureTestDatabase() in the
    // process, so it observes the freshly recreated, empty database.
    if (target === 'clean-db' || target === 'all') {
      cleanDbRes = await runCleanDatabaseGate();
    }
    if (target === 'regression' || target === 'all') {
      regressionRes = await runRegressionSuite();
    }
    if (target === 'golden' || target === 'all') {
      goldenRes = await runGoldenPath();
    }
    if (target === 'security' || target === 'all') {
      securityRes = await runSecurityDebtSuite();
    }
    if (target === 'ef1' || target === 'all') {
      ef1Res = await runEF1AcceptanceSuite();
    }
    if (target === 'ef2' || target === 'all') {
      ef2Res = await runEF2AcceptanceSuite();
    }
    if (target === 'golden-security' || target === 'all') {
      goldenSecurityRes = await runGoldenSecurityPath();
    }
    if (target === 'ef3' || target === 'all') {
      ef3Res = await runEF3AcceptanceSuite();
    }
    if (target === 'di1' || target === 'all') {
      di1Res = await runDI1AcceptanceSuite();
      di1Res.baseline = compareDI1Baseline(di1Res);
    }
  } finally {
    await stopTestServer();
    try {
      const { closePool } = require('../db/pool');
      await closePool();
    } catch (e) {}
  }

  console.log('\n===============================================================');
  console.log('                   MASTER GATE STATUS SUMMARY                  ');
  console.log('===============================================================');

  if (cleanDbRes) {
    const statusLabel = cleanDbRes.failedCount === 0 ? '[GREEN — EMPTY DB BOOTSTRAP VERIFIED]' : `[${cleanDbRes.failedCount} FAILED]`;
    console.log(`  0. DEVOS-CLEAN-DB GATE     : ${cleanDbRes.passedCount}/${cleanDbRes.total} PASSED  ${statusLabel}`);
  }
  if (regressionRes) {
    console.log(`  1. DEVOS-V1-REGRESSION   : ${regressionRes.passedCount}/${regressionRes.total} PASSED  [GREEN]`);
  }
  if (goldenRes) {
    console.log(`  2. DEVOS-GOLDEN-001       : ${goldenRes.passedCount}/${goldenRes.total} PASSED  [GREEN]`);
  }
  if (securityRes) {
    const statusLabel = securityRes.redCount === 0 ? '[GREEN — P0 SENTINELS ENFORCED]' : '[RED — P0 DEFECTS PRESENT]';
    console.log(`  3. DEVOS-SEC-KNOWN-DEBT   : ${securityRes.passedCount}/${securityRes.total} PASSED  ${statusLabel}`);
  }
  if (ef1Res) {
    const statusLabel = ef1Res.redCount === 0 ? '[GREEN — PERSISTENCE VERIFIED]' : `[${ef1Res.redCount} RED]`;
    console.log(`  4. DEVOS-EF-1 ACCEPTANCE  : ${ef1Res.passedCount}/${ef1Res.total} PASSED  ${statusLabel}`);
  }
  if (ef2Res) {
    const statusLabel = ef2Res.redCount > 0 ? `[${ef2Res.redCount} RED — PRE-IMPLEMENTATION GATE]` : `[GREEN]`;
    console.log(`  5. DEVOS-EF-2 ACCEPTANCE  : ${ef2Res.passedCount}/${ef2Res.total} PASSED  ${statusLabel}`);
  }
  if (goldenSecurityRes) {
    const statusLabel = goldenSecurityRes.failedCount === 0 ? '[GREEN]' : `[${goldenSecurityRes.failedCount} FAILED]`;
    console.log(`  6. DEVOS-GOLDEN-SEC-001 : ${goldenSecurityRes.passedCount}/${goldenSecurityRes.total} PASSED  ${statusLabel}`);
  }
  if (ef3Res) {
    const statusLabel = ef3Res.failedCount === 0 ? '[GREEN]' : `[${ef3Res.failedCount} FAILED]`;
    console.log(`  7. DEVOS-EF-3 ACCEPTANCE  : ${ef3Res.passedCount}/${ef3Res.total} PASSED  ${statusLabel}`);
    if (ef3Res.breakdown) {
      console.log(`       original EF-3       : ${ef3Res.breakdown.original.passed}/${ef3Res.breakdown.original.total}`);
      console.log(`       adversarial EF-3    : ${ef3Res.breakdown.adversarial.passed}/${ef3Res.breakdown.adversarial.total}`);
    }
  }
  if (di1Res) {
    const b = di1Res.baseline;
    const expRed = Object.values(DI1_BASELINE.tests).filter(t => t.expected === 'RED').length;
    const statusLabel = b.mismatches > 0 ? `[${b.mismatches} BASELINE MISMATCH]`
      : expRed === 0 ? '[GREEN — matches baseline, no expected RED]' : `[LOCKED — matches baseline: ${expRed} expected RED]`;
    console.log(`  8. DEVOS-DI-1 ACCEPTANCE  : ${di1Res.passedCount}/${di1Res.total} GREEN  ${statusLabel}`);
    if (b.unexpectedGreen.length) console.log(`       unexpected GREEN    : ${b.unexpectedGreen.join(', ')}`);
    if (b.unexpectedRed.length) console.log(`       unexpected RED      : ${b.unexpectedRed.join(', ')}`);
    if (b.notRun.length) console.log(`       not run             : ${b.notRun.join(', ')}`);
  }
  console.log('===============================================================\n');
  const failed =
    (cleanDbRes && cleanDbRes.failedCount > 0) ||
    (regressionRes && regressionRes.failedCount > 0) ||
    (goldenRes && goldenRes.failedCount > 0) ||
    (securityRes && securityRes.redCount > 0) ||
    (ef1Res && ef1Res.redCount > 0) ||
    (ef2Res && ef2Res.redCount > 0) ||
    (goldenSecurityRes && goldenSecurityRes.failedCount > 0) ||
    (ef3Res && ef3Res.failedCount > 0) ||
    (di1Res && di1Res.baseline.mismatches > 0);
  process.exit(failed ? 1 : 0);
}

main().catch(err => {
  console.error('[RUNNER ERROR]', err);
  process.exit(1);
});
