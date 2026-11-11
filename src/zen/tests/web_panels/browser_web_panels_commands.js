/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_shortcuts_target_the_focused_panel() {
  await BrowserTestUtils.withNewTab(
    "https://example.org/",
    async tabBrowser => {
      const { browser } = await openWebPanel("https://example.com/");
      browser.focus();
      is(document.activeElement, browser, "The panel has focus");

      EventUtils.synthesizeKey("f", { accelKey: true });
      const findbar = await TestUtils.waitForCondition(() =>
        browser.parentElement.querySelector("findbar:not([hidden])")
      );
      ok(findbar, "Find opens the panel's own findbar");
      ok(
        !gBrowser.isFindBarInitialized(gBrowser.getTabForBrowser(tabBrowser)),
        "The selected tab's findbar is left alone"
      );

      browser.focus();
      const zoom = ZoomManager.getZoomForBrowser(browser);
      EventUtils.synthesizeKey("+", { accelKey: true });
      await TestUtils.waitForCondition(
        () => ZoomManager.getZoomForBrowser(browser) > zoom,
        "Zoom in applies to the panel"
      );
      is(
        ZoomManager.getZoomForBrowser(tabBrowser),
        1,
        "The tab's zoom is unchanged"
      );

      const tabCount = gBrowser.tabs.length;
      browser.focus();
      EventUtils.synthesizeKey("w", { accelKey: true });
      await TestUtils.waitForCondition(
        () => !gZenWebPanels.activeBrowser,
        "Close hides the panel"
      );
      is(gBrowser.tabs.length, tabCount, "Close didn't close the tab");
    }
  );
  removeAllWebPanels();
});

add_task(async function test_toolbar_buttons_keep_acting_on_the_tab() {
  await BrowserTestUtils.withNewTab(
    "https://example.org/",
    async tabBrowser => {
      const { browser } = await openWebPanel("https://example.com/");
      browser.focus();
      const tabReloaded = BrowserTestUtils.browserLoaded(tabBrowser);
      document.getElementById("reload-button").doCommand();
      await tabReloaded;
      ok(true, "The toolbar reload button reloaded the tab, not the panel");
      gZenWebPanels.hide();
    }
  );
  removeAllWebPanels();
});
