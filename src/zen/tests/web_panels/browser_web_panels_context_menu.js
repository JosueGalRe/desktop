/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const LINK_PAGE = TEST_ROOT + "file_web_panels_link.html";

async function openContentContextMenu(selector, browser) {
  const menu = document.getElementById("contentAreaContextMenu");
  const shown = BrowserTestUtils.waitForEvent(menu, "popupshown");
  await BrowserTestUtils.synthesizeMouseAtCenter(
    selector,
    { type: "contextmenu", button: 2 },
    browser
  );
  await shown;
  return menu;
}

add_task(async function test_link_context_menu_opens_link_in_web_panel() {
  await BrowserTestUtils.withNewTab(LINK_PAGE, async browser => {
    const menu = await openContentContextMenu("#link", browser);
    ok(
      BrowserTestUtils.isVisible(
        document.getElementById("context-zenOpenLinkInWebPanel")
      ),
      "Links offer to open in a web panel"
    );
    ok(
      document.getElementById("context-zenAddPageToWebPanels").hidden,
      "The page entry is hidden on links"
    );
    await activateAndClose(menu, "context-zenOpenLinkInWebPanel");

    await TestUtils.waitForCondition(
      () =>
        gZenWebPanels.activeBrowser?.currentURI.spec === "https://example.org/",
      "The link opens in a web panel"
    );
    Assert.deepEqual(
      ZenWebPanelsStore.getPanels().map(panel => panel.url),
      ["https://example.org/"],
      "The link was added as a panel"
    );
    gZenWebPanels.hide();
  });
  removeAllWebPanels();
});

add_task(async function test_page_context_menu_adds_page_once() {
  // Right-clicking the empty part of the body, below the link.
  await BrowserTestUtils.withNewTab(LINK_PAGE, async browser => {
    for (let i = 0; i < 2; i++) {
      const menu = await openContentContextMenu("body", browser);
      ok(
        BrowserTestUtils.isVisible(
          document.getElementById("context-zenAddPageToWebPanels")
        ),
        "Pages offer to be added to web panels"
      );
      await activateAndClose(menu, "context-zenAddPageToWebPanels");
      await TestUtils.waitForCondition(() => gZenWebPanels.activeBrowser);
      browser.focus();
    }
    is(
      ZenWebPanelsStore.getPanels().length,
      1,
      "Adding the same page again reuses its panel"
    );

    const panelBrowser = gZenWebPanels.activeBrowser;
    await TestUtils.waitForCondition(
      () => !panelBrowser.webProgress.isLoadingDocument
    );
    const menu = await openContentContextMenu("body", panelBrowser);
    ok(
      document.getElementById("context-zenAddPageToWebPanels").hidden,
      "A panel doesn't offer to add itself"
    );
    await closePopup(menu);
    gZenWebPanels.hide();
  });
  removeAllWebPanels();
});

add_task(async function test_tab_context_menu_adds_tab() {
  await BrowserTestUtils.withNewTab("https://example.com/", async () => {
    const tab = gBrowser.selectedTab;
    const menu = document.getElementById("tabContextMenu");
    const item = document.getElementById("context_zenAddTabToWebPanels");

    let shown = BrowserTestUtils.waitForEvent(menu, "popupshown");
    EventUtils.synthesizeMouseAtCenter(tab, { type: "contextmenu", button: 2 });
    await shown;
    ok(!item.hidden, "Web tabs offer to be added to web panels");
    await activateAndClose(menu, "context_zenAddTabToWebPanels");

    await TestUtils.waitForCondition(
      () =>
        gZenWebPanels.activeBrowser?.currentURI.spec === "https://example.com/",
      "The tab's page opens in a web panel"
    );
    ok(gBrowser.tabs.includes(tab), "The tab itself stays open");
    gZenWebPanels.hide();

    const blankTab = BrowserTestUtils.addTab(gBrowser, "about:robots");
    await BrowserTestUtils.browserLoaded(blankTab.linkedBrowser);
    shown = BrowserTestUtils.waitForEvent(menu, "popupshown");
    EventUtils.synthesizeMouseAtCenter(blankTab, {
      type: "contextmenu",
      button: 2,
    });
    await shown;
    ok(item.hidden, "about: pages can't be added");
    await closePopup(menu);
    BrowserTestUtils.removeTab(blankTab);
  });
  removeAllWebPanels();
});

add_task(async function test_page_items_act_on_the_panel() {
  const { bookmarkLink, bookmarkPage } = PlacesCommandHook;
  const { populateSendTabToDevicesMenu } = gSync;
  const targets = [];

  PlacesCommandHook.bookmarkLink = async url => targets.push(url);
  PlacesCommandHook.bookmarkPage = async () => targets.push("the tab");
  gSync.populateSendTabToDevicesMenu = (popup, uri) => targets.push(uri.spec);

  try {
    await BrowserTestUtils.withNewTab("https://example.org/", async () => {
      const { browser } = await openWebPanel(LINK_PAGE);

      // Outside macOS the item sits in the navigation group, which Firefox
      // hides on browsers that aren't tabs; the command is the same.
      let menu = await openContentContextMenu("body", browser);
      gContextMenu.bookmarkThisPage();
      await closePopup(menu);

      menu = await openContentContextMenu("body", browser);
      const sendMenu = document.getElementById("context-sendpagetodevice");
      ok(BrowserTestUtils.isVisible(sendMenu), "The panel can be sent");
      const shown = BrowserTestUtils.waitForEvent(
        sendMenu.menupopup,
        "popupshown"
      );
      sendMenu.openMenu(true);
      await shown;
      await closePopup(menu);
    });
  } finally {
    Object.assign(PlacesCommandHook, { bookmarkLink, bookmarkPage });
    gSync.populateSendTabToDevicesMenu = populateSendTabToDevicesMenu;
  }

  Assert.deepEqual(
    targets,
    [LINK_PAGE, LINK_PAGE],
    "Bookmarking and sending use the panel's page, not the tab's"
  );

  removeAllWebPanels();
});
