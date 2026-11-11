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
  const shown = BrowserTestUtils.waitForEvent(
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

  const hidden = BrowserTestUtils.waitForEvent(
    PopupNotifications.panel,
    "popuphidden"
  );
  PopupNotifications.getNotification("webRTC-shareDevices", browser).remove();
  await hidden;
  gZenWebPanels.hide();
  removeAllWebPanels();
});
