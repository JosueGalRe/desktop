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

const FULLSCREEN_PREFS = [
  ["full-screen-api.allow-trusted-requests-only", false],
  ["full-screen-api.transition-duration.enter", "0 0"],
  ["full-screen-api.transition-duration.leave", "0 0"],
  ["full-screen-api.warning.timeout", 0],
];

function host() {
  return document.getElementById("zen-web-panel");
}

function sidebar() {
  return document.getElementById("zen-web-panels-sidebar");
}

function sidebarItemFor(panel) {
  return sidebar().querySelector(`[zen-web-panel-id="${panel.id}"]`);
}

/**
 * Loads a page in a panel the way its own links would, and waits for it.
 *
 * @param {Element} browser
 * @param {string} url
 */
async function loadInPanel(browser, url) {
  const loaded = BrowserTestUtils.browserLoaded(browser, false, url);
  browser.loadURI(Services.io.newURI(url), {
    triggeringPrincipal: Services.scriptSecurityManager.createNullPrincipal({}),
  });
  await loaded;
}

/**
 * Opens a panel's editor.
 *
 * @param {object} panel
 * @param {Element} [anchor] - Passed to gZenWebPanels.edit.
 * @returns {Promise<Element>} The editor popup, once open.
 */
async function editPanel(panel, anchor) {
  const editor = () => document.getElementById("zen-web-panels-editor");
  gZenWebPanels.edit(panel.id, anchor);
  await TestUtils.waitForCondition(() => editor()?.state === "open");
  return editor();
}

async function activateAndClose(menu, id) {
  const hidden = BrowserTestUtils.waitForEvent(menu, "popuphidden");
  menu.activateItem(document.getElementById(id));
  await hidden;
}

async function closePopup(popup) {
  const hidden = BrowserTestUtils.waitForEvent(popup, "popuphidden");
  popup.hidePopup();
  await hidden;
}

/**
 * Puts a browser's page in fullscreen. Needs FULLSCREEN_PREFS.
 *
 * @param {Element} browser
 */
async function goFullscreen(browser) {
  browser.focus();
  await SpecialPowers.spawn(browser, [], () =>
    content.document.body.requestFullscreen()
  );
  await TestUtils.waitForCondition(
    () => document.fullscreenElement === browser
  );
}

async function leaveFullscreen(browser) {
  await SpecialPowers.spawn(browser, [], () =>
    content.document.exitFullscreen()
  );
  await TestUtils.waitForCondition(() => !document.fullscreenElement);
}
