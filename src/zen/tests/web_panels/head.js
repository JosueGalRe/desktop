/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { ZenWebPanelsStore } = ChromeUtils.importESModule(
  "chrome://browser/content/zen-components/ZenWebPanelsStore.mjs"
);

const TEST_ROOT = getRootDirectory(gTestPath).replace(
  "chrome://mochitests/content/",
  "https://example.com/"
);

registerCleanupFunction(() => {
  Services.prefs.clearUserPref(ZenWebPanelsStore.PANELS_PREF);
  Services.prefs.clearUserPref("zen.web-panels.width");
});

/**
 * Adds a panel, shows it and waits for its page to load.
 *
 * @param {string} url
 * @param {object} [options] - Passed to ZenWebPanelsStore.addPanel.
 * @returns {Promise<{panel: object, browser: Element}>}
 */
async function openWebPanel(url, options) {
  const panel = ZenWebPanelsStore.addPanel(url, options);
  ok(panel, `${url} is accepted as a web panel`);
  gZenWebPanels.show(panel.id);
  const browser = gZenWebPanels.activeBrowser;
  await TestUtils.waitForCondition(
    () =>
      browser.currentURI.spec === panel.url &&
      browser.browsingContext.currentWindowGlobal &&
      !browser.webProgress.isLoadingDocument,
    `Waiting for the panel to load ${panel.url}`
  );
  return { panel, browser };
}

function removeAllWebPanels() {
  for (const panel of ZenWebPanelsStore.getPanels()) {
    ZenWebPanelsStore.removePanel(panel.id);
  }
}
