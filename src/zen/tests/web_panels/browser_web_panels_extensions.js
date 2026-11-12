/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_extensions_reach_a_panel_as_a_tab() {
  const extension = ExtensionTestUtils.loadExtension({
    manifest: {
      permissions: ["tabs", "webRequest", "menus", "<all_urls>"],
      content_scripts: [
        { matches: ["https://example.com/*"], js: ["content.js"] },
      ],
    },
    async background() {
      // Its events can reach the background after the page's own messages.
      const requests = new Map();
      const requestTo = url => {
        if (!requests.has(url)) {
          requests.set(url, Promise.withResolvers());
        }
        return requests.get(url);
      };

      browser.webRequest.onBeforeRequest.addListener(
        details => {
          requestTo(details.url).resolve(details.tabId);
        },
        { urls: ["https://example.com/*"], types: ["main_frame"] }
      );
      browser.tabs.onRemoved.addListener(tabId => {
        browser.test.sendMessage("removed", tabId);
      });
      browser.menus.onClicked.addListener((info, tab) => {
        browser.test.sendMessage("clicked", tab?.id);
      });
      browser.runtime.onMessage.addListener(async (message, sender) => {
        const tabId = sender.tab?.id;
        const [title] = await browser.tabs.executeScript(tabId, {
          code: "document.title",
        });
        const tabs = await browser.tabs.query({});

        browser.test.sendMessage("sender", {
          tabId,
          frameId: sender.frameId,
          requestTabId: await requestTo(sender.url).promise,
          title,
          reply: await browser.tabs.sendMessage(tabId, "ping"),
          tab: await browser.tabs.get(tabId),
          listed: tabs.some(tab => tab.id === tabId),
        });
      });
      // Only once the webRequest listener is in place.
      await browser.webRequest.handlerBehaviorChanged();
      browser.menus.create({ title: "Probe", contexts: ["page"] }, () =>
        browser.test.sendMessage("ready")
      );
    },
    files: {
      "content.js"() {
        browser.runtime.onMessage.addListener(async message =>
          message === "ping" ? "pong" : null
        );
        browser.runtime.sendMessage("hello");
      },
    },
  });
  await extension.startup();
  await extension.awaitMessage("ready");

  const { browser } = await openWebPanel(
    TEST_ROOT + "file_web_panels_link.html"
  );
  const sender = await extension.awaitMessage("sender");

  Assert.greater(sender.tabId, 0, "Messages from the panel come from a tab");
  is(sender.frameId, 0, "From its top frame");
  is(sender.requestTabId, sender.tabId, "Its requests carry that tab");
  is(sender.title, browser.contentTitle, "Scripts run in the panel's page");
  is(sender.reply, "pong", "Messages to that tab reach the panel's page");
  ok(
    sender.tab.hidden && !sender.tab.active,
    "It's a hidden tab that is never active"
  );
  ok(!sender.listed, "Which tabs.query doesn't list");

  const menu = document.getElementById("contentAreaContextMenu");
  const shown = BrowserTestUtils.waitForEvent(menu, "popupshown");
  await BrowserTestUtils.synthesizeMouseAtCenter(
    "body",
    { type: "contextmenu", button: 2 },
    browser
  );
  await shown;
  const item = menu.querySelector('menuitem[label="Probe"]');
  ok(item, "Its context menu has the extension's items");
  await activateAndClose(menu, item.id);
  is(
    await extension.awaitMessage("clicked"),
    sender.tabId,
    "Which act on the panel's tab"
  );

  removeAllWebPanels();
  is(
    await extension.awaitMessage("removed"),
    sender.tabId,
    "Removing the panel removes its tab"
  );

  await extension.unload();
});
