/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const host = () => document.getElementById("zen-web-panel");
const sidebarItemFor = panel =>
  document
    .getElementById("zen-web-panels-sidebar")
    .querySelector(`[zen-web-panel-id="${panel.id}"]`);
const panelBrowserFor = panel =>
  host().querySelector(`browser[zen-web-panel-id="${panel.id}"]`);

/**
 * Runs a test with timers of a minute or more shortened, so options counted
 * in minutes can be checked without waiting for them.
 */
async function withShortMinutes(callback) {
  const { setTimeout: realTimeout, setInterval: realInterval } = window;
  const shorten =
    real =>
    (fn, ms, ...args) =>
      real(fn, ms >= 60000 ? 100 : ms, ...args);

  window.setTimeout = shorten(realTimeout);
  window.setInterval = shorten(realInterval);

  try {
    await callback();
  } finally {
    window.setTimeout = realTimeout;
    window.setInterval = realInterval;
  }
}

add_task(async function test_editor_saves_options() {
  const panel = ZenWebPanelsStore.addPanel("https://example.com/");
  const popup = () => document.getElementById("zen-web-panels-editor");

  gZenWebPanels.edit(panel.id);
  await TestUtils.waitForCondition(() => popup()?.state === "open");

  ok(
    popup().querySelector(".zen-web-panels-editor-footer").hidden,
    "Editing a stored panel has nothing to add"
  );

  const title = popup().querySelector(".zen-web-panels-editor-title");
  title.value = "Example";
  title.dispatchEvent(new Event("change"));
  is(ZenWebPanelsStore.getPanel(panel.id).title, "Example", "Title saved");
  is(
    sidebarItemFor(panel).getAttribute("tooltiptext"),
    "Example",
    "The sidebar uses the title"
  );

  popup().querySelector('checkbox[option="floating"]').click();
  ok(ZenWebPanelsStore.getPanel(panel.id).floating, "Floating saved");

  const url = popup().querySelector(".zen-web-panels-editor-url");
  url.value = "file:///etc/passwd";
  url.dispatchEvent(new Event("change"));
  ok(
    !popup().querySelector(".zen-web-panels-editor-url-error").hidden,
    "A bad address shows an error"
  );
  is(
    ZenWebPanelsStore.getPanel(panel.id).url,
    "https://example.com/",
    "And isn't saved"
  );

  const hidden = BrowserTestUtils.waitForEvent(popup(), "popuphidden");
  popup().hidePopup();
  await hidden;
  removeAllWebPanels();
});

add_task(async function test_editor_stays_open_while_editing() {
  const { panel } = await openWebPanel("https://example.com/");
  const popup = () => document.getElementById("zen-web-panels-editor");
  const settle = () =>
    new Promise(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
  const open = async anchor => {
    gZenWebPanels.edit(panel.id, anchor);
    await TestUtils.waitForCondition(() => popup()?.state === "open");
  };

  await open();
  popup().querySelector('checkbox[option="mobile"]').click();
  await settle();
  is(popup().state, "open", "Saving re-renders the sidebar, not the editor");

  let hidden = BrowserTestUtils.waitForEvent(popup(), "popuphidden");
  popup().hidePopup();
  await hidden;

  await open(document.getElementById("zen-web-panel-more"));
  popup().querySelector('checkbox[option="hideHeader"]').click();
  await settle();
  is(popup().state, "open", "Hiding the header it opened from keeps it too");

  hidden = BrowserTestUtils.waitForEvent(popup(), "popuphidden");
  popup().hidePopup();
  await hidden;
  gZenWebPanels.hide();
  removeAllWebPanels();
});

add_task(async function test_floating_panel_closes_on_outside_click() {
  await BrowserTestUtils.withNewTab(
    "https://example.org/",
    async tabBrowser => {
      const { browser } = await openWebPanel("https://example.com/", {
        floating: true,
      });
      ok(host().hasAttribute("floating"), "The panel floats");

      EventUtils.synthesizeMouseAtCenter(browser, { type: "mousedown" });
      EventUtils.synthesizeMouseAtCenter(browser, { type: "mouseup" });
      ok(gZenWebPanels.activeBrowser, "Clicking inside keeps it open");

      EventUtils.synthesizeMouse(tabBrowser, 20, 20, { type: "mousedown" });
      EventUtils.synthesizeMouse(tabBrowser, 20, 20, { type: "mouseup" });
      ok(!gZenWebPanels.activeBrowser, "Clicking the page closes it");
    }
  );
  removeAllWebPanels();
});

add_task(async function test_hidden_header_and_badge() {
  const { panel } = await openWebPanel(
    TEST_ROOT + "file_web_panels_badge.html",
    { hideHeader: true, hideBadge: true }
  );

  ok(host().hasAttribute("hide-header"), "The header is hidden");
  await TestUtils.waitForCondition(() =>
    panelBrowserFor(panel).contentTitle.startsWith("(3)")
  );
  ok(!sidebarItemFor(panel).hasAttribute("badge"), "The badge is hidden");

  gZenWebPanels.hide();
  removeAllWebPanels();
});

add_task(async function test_restore_last_page() {
  const { panel, browser } = await openWebPanel("https://example.com/", {
    restoreLastPage: true,
  });

  const loaded = BrowserTestUtils.browserLoaded(
    browser,
    false,
    "https://example.org/"
  );
  browser.loadURI(Services.io.newURI("https://example.org/"), {
    triggeringPrincipal: Services.scriptSecurityManager.createNullPrincipal({}),
  });
  await loaded;
  await TestUtils.waitForCondition(
    () =>
      ZenWebPanelsStore.getPanel(panel.id).lastURL === "https://example.org/",
    "The last page is remembered"
  );

  gZenWebPanels.unload(panel.id);
  gZenWebPanels.show(panel.id);
  await TestUtils.waitForCondition(
    () =>
      gZenWebPanels.activeBrowser?.currentURI.spec === "https://example.org/",
    "Reopening the panel goes back to it"
  );

  gZenWebPanels.hide();
  removeAllWebPanels();
});

add_task(async function test_unload_after_inactivity() {
  await withShortMinutes(async () => {
    const { panel: first } = await openWebPanel("https://example.com/", {
      unloadAfter: 5,
    });
    await openWebPanel("https://example.org/");

    await TestUtils.waitForCondition(
      () => !panelBrowserFor(first),
      "The unused panel is unloaded"
    );
    ok(
      ZenWebPanelsStore.getPanel(first.id),
      "Unloading keeps the panel itself"
    );
  });

  gZenWebPanels.hide();
  removeAllWebPanels();
});

add_task(async function test_periodic_reload() {
  await withShortMinutes(async () => {
    const { browser } = await openWebPanel("https://example.com/", {
      reloadEvery: 1,
    });

    await BrowserTestUtils.browserLoaded(browser);
    ok(true, "The panel reloads on its own");
  });

  gZenWebPanels.hide();
  removeAllWebPanels();
});

add_task(async function test_reload_on_tab_change() {
  const { browser } = await openWebPanel("https://example.com/", {
    reloadOnTabChange: true,
  });
  const reloaded = BrowserTestUtils.browserLoaded(browser);

  await BrowserTestUtils.withNewTab("https://example.org/", async () => {
    await reloaded;
    ok(true, "Switching to another site reloads the panel");
  });

  gZenWebPanels.hide();
  removeAllWebPanels();
});

add_task(async function test_zoom_is_kept_per_panel() {
  const { panel, browser } = await openWebPanel("https://example.com/");

  browser.focus();
  EventUtils.synthesizeKey("+", { accelKey: true });
  await TestUtils.waitForCondition(
    () => ZenWebPanelsStore.getPanel(panel.id).zoom > 1,
    "The zoom is saved"
  );
  const { zoom } = ZenWebPanelsStore.getPanel(panel.id);

  gZenWebPanels.unload(panel.id);
  gZenWebPanels.show(panel.id);
  await TestUtils.waitForCondition(
    () =>
      Math.abs(
        ZoomManager.getZoomForBrowser(gZenWebPanels.activeBrowser) - zoom
      ) < 0.001,
    "Reopening the panel keeps it"
  );

  gZenWebPanels.hide();
  removeAllWebPanels();
});

add_task(async function test_temporary_panel() {
  const stored = ZenWebPanelsStore.addPanel("https://example.org/");

  gZenWebPanels.openTemporary("https://example.com/", 0);
  await TestUtils.waitForCondition(
    () =>
      gZenWebPanels.activeBrowser?.currentURI.spec === "https://example.com/"
  );
  ok(
    document.querySelector(".zen-web-panels-sidebar-item[temporary]"),
    "The sidebar shows the temporary panel"
  );
  is(ZenWebPanelsStore.getPanels().length, 1, "It isn't stored");

  gZenWebPanels.show(stored.id);
  ok(
    !document.querySelector(".zen-web-panels-sidebar-item[temporary]"),
    "Leaving it discards it"
  );
  is(host().querySelectorAll("browser").length, 1, "And its browser is gone");

  gZenWebPanels.openTemporary("https://example.com/", 0);
  await TestUtils.waitForCondition(
    () =>
      gZenWebPanels.activeBrowser?.currentURI.spec === "https://example.com/"
  );
  const browser = gZenWebPanels.activeBrowser;
  const temporaryId = browser.getAttribute("zen-web-panel-id");

  browser.focus();
  EventUtils.synthesizeKey("+", { accelKey: true });
  await TestUtils.waitForCondition(
    () => ZoomManager.getZoomForBrowser(browser) > 1,
    "The temporary panel is zoomed in"
  );
  gZenWebPanels.keepTemporary(temporaryId);

  const kept = ZenWebPanelsStore.getPanels().find(
    panel => panel.url === "https://example.com/"
  );
  ok(kept, "Keeping it stores it");
  ok(kept.zoom > 1, "With the zoom it had");
  is(gZenWebPanels.activeBrowser, browser, "Without reloading it");

  gZenWebPanels.hide();
  removeAllWebPanels();
});

add_task(async function test_panel_shortcuts() {
  ZenWebPanelsStore.addPanel("https://example.com/");
  const second = ZenWebPanelsStore.addPanel("https://example.org/");

  is(
    document.getElementById("zen-web-panel-2").getAttribute("command"),
    "cmd_zenWebPanel2",
    "Each position has its key"
  );

  document.getElementById("cmd_zenWebPanel2").doCommand();
  await TestUtils.waitForCondition(
    () => gZenWebPanels.activeBrowser?.currentURI.spec === second.url,
    "The second shortcut opens the second panel"
  );
  document.getElementById("cmd_zenWebPanel2").doCommand();
  ok(!gZenWebPanels.activeBrowser, "And closes it again");

  removeAllWebPanels();
});

add_task(async function test_dropping_tabs_and_links_on_sidebar() {
  const sidebar = document.getElementById("zen-web-panels-sidebar");
  const drop = dataTransfer => {
    for (const type of ["dragover", "drop"]) {
      sidebar.dispatchEvent(
        new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer })
      );
    }
  };

  await BrowserTestUtils.withNewTab("https://example.org/", async () => {
    const tabTransfer = new DataTransfer();
    tabTransfer.mozSetDataAt(TAB_DROP_TYPE, gBrowser.selectedTab, 0);
    drop(tabTransfer);
  });
  ok(
    ZenWebPanelsStore.getPanels().some(
      panel => panel.url === "https://example.org/"
    ),
    "A dropped tab becomes a panel"
  );

  const linkTransfer = new DataTransfer();
  linkTransfer.setData("text/uri-list", "https://example.com/");
  drop(linkTransfer);
  ok(
    ZenWebPanelsStore.getPanels().some(
      panel => panel.url === "https://example.com/"
    ),
    "A dropped link becomes a panel"
  );

  const fileTransfer = new DataTransfer();
  fileTransfer.setData("text/uri-list", "file:///etc/passwd");
  drop(fileTransfer);
  is(ZenWebPanelsStore.getPanels().length, 2, "A dropped file URL is ignored");

  gZenWebPanels.hide();
  removeAllWebPanels();
});

add_task(async function test_header_menu() {
  const { panel, browser } = await openWebPanel("https://example.com/");
  const menu = document.getElementById("zen-web-panel-more-menu");
  const runItem = async id => {
    const shown = BrowserTestUtils.waitForEvent(menu, "popupshown");
    menu.openPopup(document.getElementById("zen-web-panel-more"));
    await shown;
    const hidden = BrowserTestUtils.waitForEvent(menu, "popuphidden");
    menu.activateItem(document.getElementById(id));
    await hidden;
  };

  const tabOpened = BrowserTestUtils.waitForNewTab(
    gBrowser,
    "https://example.com/",
    true
  );
  await runItem("zen-web-panel-open-in-tab");
  const tab = await tabOpened;
  ok(true, "Open in New Tab opens the panel's page");
  BrowserTestUtils.removeTab(tab);

  await SimpleTest.promiseClipboardChange("https://example.com/", () =>
    runItem("zen-web-panel-copy-link")
  );
  ok(true, "Copy Link copies the panel's address");

  const away = BrowserTestUtils.browserLoaded(browser);
  browser.loadURI(Services.io.newURI("https://example.org/"), {
    triggeringPrincipal: Services.scriptSecurityManager.createNullPrincipal({}),
  });
  await away;
  const home = BrowserTestUtils.browserLoaded(browser, false, panel.url);
  await runItem("zen-web-panel-go-home");
  await home;
  ok(true, "Go to Panel Home goes back to the panel's address");

  gZenWebPanels.hide();
  removeAllWebPanels();
});

add_task(async function test_sound_indicator_and_mute() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["media.autoplay.default", 0],
      ["media.volume_scale", "0.0"],
    ],
  });
  const { panel, browser } = await openWebPanel(
    TEST_ROOT + "file_web_panels_media.html"
  );
  const item = sidebarItemFor(panel);

  await TestUtils.waitForCondition(
    () => item.hasAttribute("soundplaying"),
    "The sidebar shows the panel is playing sound"
  );

  const menu = document.getElementById("zen-web-panels-context");
  const shown = BrowserTestUtils.waitForEvent(menu, "popupshown");
  EventUtils.synthesizeMouseAtCenter(item, { type: "contextmenu", button: 2 });
  await shown;
  const hidden = BrowserTestUtils.waitForEvent(menu, "popuphidden");
  menu.activateItem(document.getElementById("zen-web-panels-context-mute"));
  await hidden;

  ok(browser.browsingContext.mediaController.isMuted, "Mute mutes the panel");
  await TestUtils.waitForCondition(
    () => item.hasAttribute("muted") && !item.hasAttribute("soundplaying"),
    "And the indicator says so"
  );

  // The indicator is the item's corner.
  const { width, height } = item.getBoundingClientRect();
  EventUtils.synthesizeMouse(item, width - 4, height - 4, {});
  await TestUtils.waitForCondition(
    () => item.hasAttribute("soundplaying"),
    "Clicking the indicator unmutes the panel"
  );
  is(gZenWebPanels.activeBrowser, browser, "Without closing it");

  // Pressing the indicator and letting go somewhere else isn't a click.
  EventUtils.synthesizeMouse(item, width - 4, height - 4, {
    type: "mousedown",
  });
  EventUtils.synthesizeMouseAtCenter(
    document.querySelector(".zen-web-panels-sidebar-add"),
    { type: "mouseup" }
  );
  EventUtils.synthesizeMouseAtCenter(item, {});
  ok(!gZenWebPanels.activeBrowser, "So the next click still closes the panel");
  ok(!browser.browsingContext.mediaController.isMuted, "And nothing was muted");

  browser.browsingContext.mediaController.pause("user");
  gZenWebPanels.hide();
  removeAllWebPanels();
});

add_task(async function test_panel_audio_with_media_controls_off() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["zen.mediacontrols.enabled", false],
      // Otherwise the new window's tab is synced into this one.
      ["zen.window-sync.enabled", false],
      ["media.autoplay.default", 0],
      ["media.volume_scale", "0.0"],
      // The test tone is shorter than the media Firefox lets you control.
      ["media.mediacontrol.eligible.media.duration.s", "0.5"],
    ],
  });
  const win = await BrowserTestUtils.openNewBrowserWindow();
  await win.gZenWorkspaces.promiseInitialized;
  const panel = ZenWebPanelsStore.addPanel(
    TEST_ROOT + "file_web_panels_media.html"
  );

  win.gZenWebPanels.show(panel.id);
  const browser = win.gZenWebPanels.activeBrowser;
  await TestUtils.waitForCondition(
    () => browser.browsingContext?.mediaController?.isActive,
    "The panel plays its audio"
  );

  // Panels report playback to the media controller directly.
  win.gZenMediaController.onAudioPlaybackStarted(browser);
  ok(true, "Without media controls there's no card to add");

  browser.browsingContext.mediaController.pause("user");
  await BrowserTestUtils.closeWindow(win);
  removeAllWebPanels();
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_editing_the_visible_panel_keeps_the_focus() {
  const { panel } = await openWebPanel("https://example.com/");
  const popup = () => document.getElementById("zen-web-panels-editor");

  gZenWebPanels.edit(panel.id);
  await TestUtils.waitForCondition(() => popup()?.state === "open");
  const url = popup().querySelector(".zen-web-panels-editor-url");
  url.focus();
  url.value = "https://example.org/";
  url.dispatchEvent(new Event("change"));

  await TestUtils.waitForCondition(
    () =>
      gZenWebPanels.activeBrowser?.currentURI.spec === "https://example.org/",
    "The panel loads its new address"
  );
  is(document.activeElement, url, "The focus stays in the editor");

  const hidden = BrowserTestUtils.waitForEvent(popup(), "popuphidden");
  popup().hidePopup();
  await hidden;
  gZenWebPanels.hide();
  removeAllWebPanels();
});

add_task(async function test_last_page_ignores_a_quick_round_trip() {
  // History entries need user interaction to be gone back to otherwise.
  await SpecialPowers.pushPrefEnv({
    set: [["browser.navigation.requireUserInteraction", false]],
  });
  const { panel, browser } = await openWebPanel("https://example.com/", {
    restoreLastPage: true,
  });
  await TestUtils.waitForCondition(
    () =>
      ZenWebPanelsStore.getPanel(panel.id).lastURL === "https://example.com/",
    "The first page is remembered"
  );

  const away = BrowserTestUtils.browserLoaded(
    browser,
    false,
    "https://example.org/"
  );
  browser.loadURI(Services.io.newURI("https://example.org/"), {
    triggeringPrincipal: Services.scriptSecurityManager.createNullPrincipal({}),
  });
  await away;
  browser.goBack();
  await TestUtils.waitForCondition(
    () => browser.currentURI.spec === "https://example.com/"
  );

  // Longer than the delay before a page is saved.
  // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
  await new Promise(resolve => setTimeout(resolve, 1500));
  is(
    ZenWebPanelsStore.getPanel(panel.id).lastURL,
    "https://example.com/",
    "A page left before it was saved isn't saved later"
  );

  gZenWebPanels.hide();
  removeAllWebPanels();
});

add_task(async function test_resizer_widens_toward_its_side() {
  await openWebPanel("https://example.com/");
  const resizer = host().querySelector(".zen-web-panel-resizer");
  const originalDir = document.documentElement.getAttribute("dir");

  for (const dir of ["ltr", "rtl"]) {
    document.documentElement.setAttribute("dir", dir);
    await new Promise(resolve => requestAnimationFrame(resolve));

    const hostBounds = host().getBoundingClientRect();
    const bounds = resizer.getBoundingClientRect();
    const outward =
      bounds.left < hostBounds.left + hostBounds.width / 2 ? -40 : 40;
    const x = bounds.width / 2;
    const y = bounds.height / 2;

    EventUtils.synthesizeMouse(resizer, x, y, { type: "mousedown" });
    EventUtils.synthesizeMouse(resizer, x + outward, y, { type: "mousemove" });
    EventUtils.synthesizeMouse(resizer, x + outward, y, { type: "mouseup" });
    Assert.greater(
      host().getBoundingClientRect().width,
      hostBounds.width,
      `Dragging the resizer outward widens the panel (${dir})`
    );
  }

  if (originalDir) {
    document.documentElement.setAttribute("dir", originalDir);
  } else {
    document.documentElement.removeAttribute("dir");
  }

  gZenWebPanels.hide();
  removeAllWebPanels();
});

add_task(async function test_icon_picker_closed_without_a_pick() {
  const { panel } = await openWebPanel("https://example.com/");
  const editor = () => document.getElementById("zen-web-panels-editor");
  const picker = document.getElementById("PanelUI-zen-emojis-picker");

  gZenWebPanels.edit(panel.id);
  await TestUtils.waitForCondition(() => editor()?.state === "open");
  editor().querySelector(".zen-web-panels-editor-icon").doCommand();
  await TestUtils.waitForCondition(() => picker.state === "open");

  let hidden = BrowserTestUtils.waitForEvent(picker, "popuphidden");
  picker.hidePopup();
  await hidden;
  await TestUtils.waitForTick();
  ok(true, "Closing the icon picker without a pick is fine");

  hidden = BrowserTestUtils.waitForEvent(editor(), "popuphidden");
  editor().hidePopup();
  await hidden;
  gZenWebPanels.hide();
  removeAllWebPanels();
});
