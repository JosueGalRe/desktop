/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_panel_runs_in_a_web_content_process() {
  const tabCount = gBrowser.tabs.length;
  const { browser } = await openWebPanel("https://example.com/");

  ok(browser.isRemoteBrowser, "The panel browser is remote");
  ok(
    browser.remoteType.startsWith("webIsolated="),
    `The panel runs in a site-isolated web process (${browser.remoteType})`
  );
  const windowGlobal = browser.browsingContext.currentWindowGlobal;
  isnot(
    windowGlobal.osPid,
    Services.appinfo.processID,
    "The panel's page doesn't run in the parent process"
  );
  ok(
    !windowGlobal.documentPrincipal.isSystemPrincipal,
    "The panel's page doesn't get the system principal"
  );
  is(
    windowGlobal.documentPrincipal.origin,
    "https://example.com",
    "The page gets its own content principal"
  );
  ok(!gBrowser.getTabForBrowser(browser), "The panel is not a tab");
  is(gBrowser.tabs.length, tabCount, "Opening a panel doesn't add tabs");

  removeAllWebPanels();
});
