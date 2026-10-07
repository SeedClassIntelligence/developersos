// ══════════════════════════════════════════════════════════════
// DeveloperOS Test Suite Master Runner
// Controls execution of Regression, Golden Path, Security, and Phase Acceptance
// ══════════════════════════════════════════════════════════════

require('./test-env'); // MUST be first: redirects DATABASE_URL to the isolated *_test database
const { runRegressionSuite } = require('./devos-v1-regression.test');
const { runGoldenPath } = require('./devos-golden-001.test');
const { runSecurityDebtSuite } = require('./devos-sec-known-debt.test');
const { runEF1AcceptanceSuite } = require('./devos-ef1-acceptance.test');
const { runEF2AcceptanceSuite } = require('./devos-ef2-acceptance.test');
const { runGoldenSecurityPath } = require('./devos-golden-sec-001.test');
const { runEF3AcceptanceSuite } = require('./devos-ef3-acceptance.test');
const { stopTestServer } = require('./helpers');

async function main() {
  const target = process.argv[2] || 'all';

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║       DEVELOPEROS GATED TEST HARNESS — MASTER RUNNER         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  let regressionRes = null;
  let goldenRes = null;
  let securityRes = null;
  let ef1Res = null;
  let ef2Res = null;
  let goldenSecurityRes = null;
  let ef3Res = null;

  try {
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
  }
  console.log('===============================================================\n');
  const failed =
    (regressionRes && regressionRes.failedCount > 0) ||
    (goldenRes && goldenRes.failedCount > 0) ||
    (securityRes && securityRes.redCount > 0) ||
    (ef1Res && ef1Res.redCount > 0) ||
    (ef2Res && ef2Res.redCount > 0) ||
    (goldenSecurityRes && goldenSecurityRes.failedCount > 0) ||
    (ef3Res && ef3Res.failedCount > 0);
  process.exit(failed ? 1 : 0);
}

main().catch(err => {
  console.error('[RUNNER ERROR]', err);
  process.exit(1);
});
