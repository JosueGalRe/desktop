/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(function test_only_http_urls_are_allowed() {
  for (const url of [
    "chrome://browser/content/browser.xhtml",
    "resource:///modules/",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,hi",
    "about:config",
    "view-source:https://example.com/",
    "moz-extension://id/page.html",
  ]) {
    is(ZenWebPanelsStore.normalizeURL(url), null, `${url} is rejected`);
    ok(!ZenWebPanelsStore.isAllowedURL(url), `${url} is not allowed`);
    is(ZenWebPanelsStore.addPanel(url), null, `${url} can't be added`);
  }
  is(
    ZenWebPanelsStore.normalizeURL("example.com"),
    "https://example.com/",
    "Addresses without a scheme default to https"
  );
  is(
    ZenWebPanelsStore.normalizeURL("http://example.com/path"),
    "http://example.com/path",
    "An explicit http address is kept"
  );
  is(ZenWebPanelsStore.getPanels().length, 0, "Nothing was stored");
});

add_task(function test_tampered_pref_is_filtered() {
  Services.prefs.setStringPref(
    ZenWebPanelsStore.PANELS_PREF,
    JSON.stringify([
      { id: "a", url: "chrome://browser/content/browser.xhtml" },
      { id: "b", url: "https://example.com/", userContextId: -1 },
      { id: "c", url: "https://example.com/", mobile: "yes" },
      { id: "d", url: "https://example.com/" },
      { id: "d", url: "https://example.org/" },
      "junk",
      null,
    ])
  );
  const [panel, ...rest] = ZenWebPanelsStore.getPanels();
  is(rest.length, 0, "Only one entry survives");
  is(panel.id, "d", "It's the first valid entry for its id");
  is(panel.url, "https://example.com/", "With its own URL");
  is(panel.userContextId, 0, "Missing options get their default");
  is(panel.zoom, 1, "Zoom defaults to 100%");

  Services.prefs.setStringPref(ZenWebPanelsStore.PANELS_PREF, "{not json");
  Assert.deepEqual(
    ZenWebPanelsStore.getPanels(),
    [],
    "Broken JSON reads as empty"
  );
  Services.prefs.clearUserPref(ZenWebPanelsStore.PANELS_PREF);
});

add_task(function test_update_validates() {
  const panel = ZenWebPanelsStore.addPanel("https://example.com/");
  ok(
    !ZenWebPanelsStore.updatePanel(panel.id, { url: "file:///etc/passwd" }),
    "A panel can't be pointed at a file URL"
  );
  ok(
    ZenWebPanelsStore.updatePanel(panel.id, { mobile: true }),
    "Valid changes are saved"
  );
  is(
    ZenWebPanelsStore.getPanels()[0].url,
    "https://example.com/",
    "URL unchanged"
  );
  ok(ZenWebPanelsStore.getPanels()[0].mobile, "Mobile flag saved");
  removeAllWebPanels();
});

add_task(function test_options_are_validated() {
  for (const [option, value] of [
    ["icon", "https://example.com/icon.png"],
    ["icon", "data:text/html,<script>alert(1)</script>"],
    ["lastURL", "file:///etc/passwd"],
    ["zoom", 50],
    ["unloadAfter", -1],
    ["reloadEvery", 1.5],
    ["floating", "yes"],
    ["title", "x".repeat(201)],
  ]) {
    is(
      ZenWebPanelsStore.addPanel("https://example.com/", { [option]: value }),
      null,
      `${option}: ${String(value).slice(0, 40)} is rejected`
    );
  }

  const panel = ZenWebPanelsStore.addPanel("https://example.com/", {
    floating: true,
    unloadAfter: 15,
    icon: "data:image/svg+xml;base64,PHN2Zy8+",
  });
  ok(panel.floating, "Valid options are kept");
  is(panel.unloadAfter, 15, "Including minutes");
  removeAllWebPanels();
});
