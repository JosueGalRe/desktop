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
