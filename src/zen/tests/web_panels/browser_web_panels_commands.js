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
  await SpecialPowers.pushPrefEnv({
    set: [
      ["full-screen-api.allow-trusted-requests-only", false],
      ["full-screen-api.transition-duration.enter", "0 0"],
      ["full-screen-api.transition-duration.leave", "0 0"],
      ["full-screen-api.warning.timeout", 0],
    ],
  });
  const { browser } = await openWebPanel("https://example.com/");

  await SpecialPowers.spawn(browser, [], () =>
    content.document.body.requestFullscreen()
  );
  await TestUtils.waitForCondition(
    () => document.fullscreenElement === browser,
    "The panel's page goes fullscreen"
  );
  is(
    Math.round(browser.getBoundingClientRect().width),
    window.innerWidth,
    "It covers the whole window"
  );

  await SpecialPowers.spawn(browser, [], () =>
    content.document.exitFullscreen()
  );
  await TestUtils.waitForCondition(
    () => !document.fullscreenElement,
    "And leaves fullscreen"
  );

  // Hiding the panel takes its page out of fullscreen.
  await SpecialPowers.spawn(browser, [], () =>
    content.document.body.requestFullscreen()
  );
  await TestUtils.waitForCondition(
    () => document.fullscreenElement === browser
  );
  gZenWebPanels.hide();
  await TestUtils.waitForCondition(
    () =>
      !document.fullscreenElement &&
      !document.documentElement.hasAttribute("inDOMFullscreen"),
    "Hiding the panel leaves fullscreen"
  );
  gZenWebPanels.show(browser.getAttribute("zen-web-panel-id"));

  // The browser in fullscreen covers the window from the top layer, so an
  // open panel doesn't take room from a tab in fullscreen either.
  await BrowserTestUtils.withNewTab("https://example.org/", async tab => {
    await SpecialPowers.spawn(tab, [], () =>
      content.document.body.requestFullscreen()
    );
    await TestUtils.waitForCondition(
      () => document.fullscreenElement === tab,
      "The tab goes fullscreen with the panel open"
    );
    is(
      Math.round(tab.getBoundingClientRect().width),
      window.innerWidth,
      "And covers the whole window"
    );
    await SpecialPowers.spawn(tab, [], () => content.document.exitFullscreen());
    await TestUtils.waitForCondition(() => !document.fullscreenElement);
  });

  gZenWebPanels.hide();
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
    const loaded = BrowserTestUtils.browserLoaded(
      browser,
      false,
      "https://example.org/"
    );
    browser.loadURI(Services.io.newURI("https://example.org/"), {
      triggeringPrincipal: Services.scriptSecurityManager.createNullPrincipal(
        {}
      ),
    });
    await loaded;

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

  gZenWebPanels.hide();
  removeAllWebPanels();
});
