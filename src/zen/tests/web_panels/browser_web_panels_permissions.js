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
