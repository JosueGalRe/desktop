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

add_task(async function test_panel_page_can_go_fullscreen() {
  await SpecialPowers.pushPrefEnv({ set: FULLSCREEN_PREFS });
  const { browser } = await openWebPanel("https://example.com/");

  await goFullscreen(browser);
  is(
    Math.round(browser.getBoundingClientRect().width),
    window.innerWidth,
    "The panel's page in fullscreen covers the whole window"
  );
  await leaveFullscreen(browser);

  // Hiding the panel takes its page out of fullscreen.
  await goFullscreen(browser);
  gZenWebPanels.hide();
  await TestUtils.waitForCondition(
    () =>
      !document.fullscreenElement &&
      !document.documentElement.hasAttribute("inDOMFullscreen"),
    "Hiding the panel leaves fullscreen"
  );
  gZenWebPanels.show(browser.getAttribute("zen-web-panel-id"));

  // So does switching to another panel.
  const other = ZenWebPanelsStore.addPanel("https://example.org/");
  await goFullscreen(browser);
  gZenWebPanels.show(other.id);
  await TestUtils.waitForCondition(
    () =>
      !document.fullscreenElement &&
      !document.documentElement.hasAttribute("inDOMFullscreen"),
    "Switching panels leaves fullscreen"
  );
  gZenWebPanels.show(browser.getAttribute("zen-web-panel-id"));

  // A tab in fullscreen takes the whole window too, with a panel open.
  await BrowserTestUtils.withNewTab("https://example.org/", async tab => {
    await goFullscreen(tab);
    is(
      Math.round(tab.getBoundingClientRect().width),
      window.innerWidth,
      "The tab in fullscreen covers the whole window"
    );
    await leaveFullscreen(tab);
  });

  removeAllWebPanels();
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_navigation_keys_when_the_tab_cant_navigate() {
  // History entries need user interaction to be gone back to otherwise.
  await SpecialPowers.pushPrefEnv({
    set: [["browser.navigation.requireUserInteraction", false]],
  });
  await BrowserTestUtils.withNewTab("about:blank", async tabBrowser => {
    const { browser } = await openWebPanel("https://example.com/");
    await loadInPanel(browser, "https://example.org/");

    const disabled = id => document.getElementById(id).hasAttribute("disabled");
    tabBrowser.focus();
    ok(
      disabled("Browser:Back") && disabled("Browser:Reload"),
      "The blank tab can't go back or reload"
    );

    browser.focus();
    if (AppConstants.platform == "macosx") {
      EventUtils.synthesizeKey("[", { accelKey: true });
    } else {
      EventUtils.synthesizeKey("KEY_ArrowLeft", { altKey: true });
    }
    await TestUtils.waitForCondition(
      () => browser.currentURI.spec === "https://example.com/",
      "The panel goes back anyway"
    );

    const reloaded = BrowserTestUtils.browserLoaded(browser);
    EventUtils.synthesizeKey("r", { accelKey: true });
    await reloaded;
    ok(true, "And reloads");

    tabBrowser.focus();
    ok(
      disabled("Browser:Back") && disabled("Browser:Reload"),
      "The tab gets its own commands back with the focus"
    );
  });

  removeAllWebPanels();
});
