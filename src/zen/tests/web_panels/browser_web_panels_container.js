/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({
    set: [["privacy.userContext.enabled", true]],
  });
});

add_task(async function test_panel_loads_in_its_container() {
  const identity = ContextualIdentityService.create(
    "Web panels",
    "briefcase",
    "blue"
  );
  const { browser } = await openWebPanel("https://example.com/", {
    userContextId: identity.userContextId,
  });
  is(
    browser.browsingContext.currentWindowGlobal.documentPrincipal
      .originAttributes.userContextId,
    identity.userContextId,
    "The page loads in the panel's container"
  );
  removeAllWebPanels();
  ContextualIdentityService.remove(identity.userContextId);
});

add_task(async function test_missing_container_falls_back_to_default() {
  const { browser } = await openWebPanel("https://example.com/", {
    userContextId: 9999,
  });
  is(
    browser.browsingContext.currentWindowGlobal.documentPrincipal
      .originAttributes.userContextId,
    0,
    "A container that no longer exists falls back to no container"
  );

  await loadInPanel(browser, "https://example.org/");

  const home = BrowserTestUtils.browserLoaded(
    browser,
    false,
    "https://example.com/"
  );
  document.getElementById("zen-web-panel-go-home").doCommand();
  await home;
  ok(true, "Going back to the panel's page loads it in the same way");

  removeAllWebPanels();
});
