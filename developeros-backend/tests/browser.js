// Launches headless Chromium for the UI gates. CI installs the browser build
// that matches the locked Playwright version; elsewhere DEVOS_CHROMIUM_PATH
// can point at a pre-installed Chromium (e.g. /opt/pw-browsers/chromium).
function launchChromium() {
  const { chromium } = require('playwright');
  const executablePath = process.env.DEVOS_CHROMIUM_PATH || undefined;
  return chromium.launch(executablePath ? { executablePath } : {});
}

module.exports = { launchChromium };
