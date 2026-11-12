/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["media.navigator.streams.fake", true],
      ["media.navigator.permission.fake", false],
    ],
  });
});

add_task(async function test_permission_prompt_shows_for_the_panel() {
  const shown = BrowserTestUtils.waitForEvent(
    PopupNotifications.panel,
    "popupshown"
  );
  const { browser } = await openWebPanel(
    TEST_ROOT + "file_web_panels_permission.html"
  );
  await shown;

  const notification = PopupNotifications.getNotification(
    "webRTC-shareDevices",
    browser
  );
  ok(notification, "The panel's permission request shows a prompt");
  ok(
    notification.anchorElement.closest("#zen-web-panel"),
    "The prompt points at the panel, not the urlbar"
  );

  const hidden = BrowserTestUtils.waitForEvent(
    PopupNotifications.panel,
    "popuphidden"
  );
  notification.remove();
  await hidden;
  gZenWebPanels.hide();
  removeAllWebPanels();
});

add_task(async function test_content_prompts_cover_the_panel() {
  const { PromptTestUtils } = ChromeUtils.importESModule(
    "resource://testing-common/PromptTestUtils.sys.mjs"
  );
  const { browser } = await openWebPanel("https://example.com/");

  const promptShown = PromptTestUtils.waitForPrompt(browser, {
    modalType: Services.prompt.MODAL_TYPE_CONTENT,
    promptType: "alert",
  });
  await SpecialPowers.spawn(browser, [], () => {
    content.setTimeout(() => content.alert("Hi from the panel"), 0);
  });
  const dialog = await promptShown;

  const stack = browser.parentElement.querySelector(".content-prompt-dialog");
  const panelBounds = browser.getBoundingClientRect();
  const stackBounds = stack.getBoundingClientRect();
  ok(
    Math.abs(stackBounds.left - panelBounds.left) < 1 &&
      Math.abs(stackBounds.right - panelBounds.right) < 1,
    "The prompt covers the panel, not the tab"
  );

  await PromptTestUtils.handlePrompt(dialog, { buttonNumClick: 0 });
  gZenWebPanels.hide();
  removeAllWebPanels();
});

add_task(async function test_permission_prompt_follows_its_panel() {
  const doorhanger = PopupNotifications.panel;
  const anchor = () =>
    document.getElementById("zen-web-panel-notification-anchor");
  const host = document.getElementById("zen-web-panel");
  const settle = async () => {
    await TestUtils.waitForTick();
    await TestUtils.waitForTick();
    await new Promise(resolve => requestAnimationFrame(resolve));
  };
  const panel = ZenWebPanelsStore.addPanel(
    TEST_ROOT + "file_web_panels_permission.html"
  );
  const other = ZenWebPanelsStore.addPanel("https://example.org/");

  gZenWebPanels.show(panel.id);
  gZenWebPanels.show(other.id);
  const browser = host.querySelector(`browser[zen-web-panel-id="${panel.id}"]`);
  await TestUtils.waitForCondition(
    () => PopupNotifications.getNotification("webRTC-shareDevices", browser),
    "The request arrives while another panel is in front"
  );
  await settle();
  is(doorhanger.state, "closed", "It waits for its own panel");
  ok(!BrowserTestUtils.isVisible(anchor()), "The other panel doesn't offer it");

  let shown = BrowserTestUtils.waitForEvent(doorhanger, "popupshown");
  gZenWebPanels.show(panel.id);
  await shown;
  ok(host.contains(doorhanger.anchorNode), "Its panel shows it");

  await BrowserTestUtils.withNewTab("https://example.org/", async () => {
    await settle();
    is(doorhanger.state, "open", "Switching tabs keeps it open");
  });

  let hidden = BrowserTestUtils.waitForEvent(doorhanger, "popuphidden");
  gZenWebPanels.hide();
  await hidden;
  ok(true, "Hiding the panel hides its prompt");

  gZenWebPanels.show(panel.id);
  await settle();
  ok(BrowserTestUtils.isVisible(anchor()), "Its header offers the request");
  shown = BrowserTestUtils.waitForEvent(doorhanger, "popupshown");
  anchor().doCommand();
  await shown;
  ok(host.contains(doorhanger.anchorNode), "And brings the prompt back");

  hidden = BrowserTestUtils.waitForEvent(doorhanger, "popuphidden");
  browser.loadURI(Services.io.newURI("https://example.org/"), {
    triggeringPrincipal: Services.scriptSecurityManager.createNullPrincipal({}),
  });
  await hidden;
  await TestUtils.waitForCondition(
    () => !PopupNotifications.getNotification("webRTC-shareDevices", browser),
    "Leaving the page drops its request"
  );
  await settle();
  ok(!BrowserTestUtils.isVisible(anchor()), "And the header stops offering it");

  gZenWebPanels.hide();
  removeAllWebPanels();
});

add_task(async function test_permission_prompt_without_the_header() {
  let shown = BrowserTestUtils.waitForEvent(
    PopupNotifications.panel,
    "popupshown"
  );
  const { browser } = await openWebPanel(
    TEST_ROOT + "file_web_panels_permission.html",
    { hideHeader: true }
  );
  await shown;
  ok(
    document
      .getElementById("zen-web-panel")
      .contains(PopupNotifications.panel.anchorNode),
    "With the header hidden the prompt still points at the panel"
  );

  let hidden = BrowserTestUtils.waitForEvent(
    PopupNotifications.panel,
    "popuphidden"
  );
  PopupNotifications.getNotification("webRTC-shareDevices", browser).remove();
  await hidden;

  // Permission prompts are persistent; others, like saving a password, go
  // away when dismissed, and the header button is what brings them back.
  shown = BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");
  const notification = PopupNotifications.show(
    browser,
    "zen-web-panels-test",
    "A request that isn't persistent",
    null,
    { label: "OK", accessKey: "O", callback() {} }
  );
  await shown;
  hidden = BrowserTestUtils.waitForEvent(
    PopupNotifications.panel,
    "popuphidden"
  );
  PopupNotifications.panel.hidePopup();
  await hidden;
  ok(notification.dismissed, "Clicking away dismisses it");

  gZenWebPanels.hide();
  shown = BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");
  gZenWebPanels.show(browser.getAttribute("zen-web-panel-id"));
  await shown;
  ok(true, "Without the header, showing the panel brings it back");

  hidden = BrowserTestUtils.waitForEvent(
    PopupNotifications.panel,
    "popuphidden"
  );
  notification.remove();
  await hidden;
  gZenWebPanels.hide();
  removeAllWebPanels();
});

add_task(async function test_http_auth_in_a_panel() {
  const { PromptTestUtils } = ChromeUtils.importESModule(
    "resource://testing-common/PromptTestUtils.sys.mjs"
  );
  const panel = ZenWebPanelsStore.addPanel(
    TEST_ROOT + "file_web_panels_auth.sjs"
  );

  gZenWebPanels.show(panel.id);
  const browser = gZenWebPanels.activeBrowser;
  const dialog = await PromptTestUtils.waitForPrompt(browser, {
    modalType: Services.prompt.MODAL_TYPE_TAB,
    promptType: "promptUserAndPass",
  });
  await PromptTestUtils.handlePrompt(dialog, {
    loginInput: "zen",
    passwordInput: "panel",
    buttonNumClick: 0,
  });
  await TestUtils.waitForCondition(
    () => browser.contentTitle === "authenticated",
    "The credentials reach the page"
  );

  PopupNotifications.getNotification("password", browser)?.remove();
  Cc["@mozilla.org/network/http-auth-manager;1"]
    .getService(Ci.nsIHttpAuthManager)
    .clearAll();
  gZenWebPanels.hide();
  removeAllWebPanels();
});

add_task(async function test_tab_icons_with_a_panel_request_pending() {
  const shown = BrowserTestUtils.waitForEvent(
    PopupNotifications.panel,
    "popupshown"
  );
  const { browser } = await openWebPanel(
    TEST_ROOT + "file_web_panels_permission.html"
  );
  await shown;

  const icon = document.getElementById("geo-notification-icon");
  const settle = async () => {
    await TestUtils.waitForTick();
    await TestUtils.waitForTick();
  };
  const firstTab = gBrowser.selectedTab;
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "https://example.org/"
  );
  // Only its urlbar icon: the panel's prompt stays in front.
  const tabNotification = PopupNotifications.show(
    tab.linkedBrowser,
    "zen-web-panels-test",
    "The tab's own request",
    "geo-notification-icon",
    { label: "OK", accessKey: "O", callback() {} },
    null,
    { dismissed: true }
  );
  await settle();
  ok(icon.hasAttribute("showing"), "The tab shows its request's icon");

  gBrowser.selectedTab = firstTab;
  await settle();
  ok(!icon.hasAttribute("showing"), "Another tab doesn't show it");

  gBrowser.selectedTab = tab;
  await settle();
  ok(icon.hasAttribute("showing"), "Coming back shows it again");
  is(
    PopupNotifications.panel.state,
    "open",
    "With the panel's prompt still open"
  );

  tabNotification.remove();
  BrowserTestUtils.removeTab(tab);
  const hidden = BrowserTestUtils.waitForEvent(
    PopupNotifications.panel,
    "popuphidden"
  );
  PopupNotifications.getNotification("webRTC-shareDevices", browser).remove();
  await hidden;
  gZenWebPanels.hide();
  removeAllWebPanels();
});
