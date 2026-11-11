/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const sidebar = () => document.getElementById("zen-web-panels-sidebar");
const sidebarItems = () => [
  ...sidebar().querySelectorAll(".zen-web-panels-sidebar-item"),
];
const sidebarItemFor = panel =>
  sidebar().querySelector(`[zen-web-panel-id="${panel.id}"]`);

add_task(async function test_sidebar_lists_and_toggles_panels() {
  const first = ZenWebPanelsStore.addPanel("https://example.com/");
  const second = ZenWebPanelsStore.addPanel("https://example.org/");

  Assert.deepEqual(
    sidebarItems().map(item => item.getAttribute("zen-web-panel-id")),
    [first.id, second.id],
    "The sidebar lists the panels in order"
  );

  sidebarItemFor(second).doCommand();
  await TestUtils.waitForCondition(
    () => gZenWebPanels.activeBrowser?.currentURI.spec === second.url,
    "Clicking an item opens its panel"
  );
  ok(
    sidebarItemFor(second).hasAttribute("checked"),
    "The open panel's item is checked"
  );

  sidebarItemFor(second).doCommand();
  ok(!gZenWebPanels.activeBrowser, "Clicking it again closes the panel");
  ok(
    !sidebarItemFor(second).hasAttribute("checked"),
    "Its item isn't checked anymore"
  );

  removeAllWebPanels();
  is(sidebarItems().length, 0, "Removed panels leave the sidebar");
});

add_task(async function test_unread_badge_comes_from_the_title() {
  const { panel, browser } = await openWebPanel(
    TEST_ROOT + "file_web_panels_badge.html"
  );

  await TestUtils.waitForCondition(
    () => sidebarItemFor(panel).getAttribute("badge") === "3",
    "The item shows the count from the page title"
  );

  await SpecialPowers.spawn(browser, [], () => {
    content.document.title = "Artist - Song (2019)";
  });
  await TestUtils.waitForCondition(
    () => !sidebarItemFor(panel).hasAttribute("badge"),
    "A number later in the title isn't a count"
  );

  gZenWebPanels.hide();
  removeAllWebPanels();
});

add_task(async function test_dragging_an_item_reorders_panels() {
  const first = ZenWebPanelsStore.addPanel("https://example.com/");
  const second = ZenWebPanelsStore.addPanel("https://example.org/");
  const source = sidebarItemFor(first);
  const target = sidebarItemFor(second);
  const bounds = target.getBoundingClientRect();
  const dataTransfer = new DataTransfer();
  const drag = (type, element, clientY = 0) =>
    element.dispatchEvent(
      new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        clientY,
        dataTransfer,
      })
    );

  drag("dragstart", source);
  drag("dragover", target, bounds.bottom - 1);
  drag("drop", target, bounds.bottom - 1);
  drag("dragend", source);

  Assert.deepEqual(
    ZenWebPanelsStore.getPanels().map(panel => panel.id),
    [second.id, first.id],
    "Dropping below the other item moves the panel after it"
  );
  Assert.deepEqual(
    sidebarItems().map(item => item.getAttribute("zen-web-panel-id")),
    [second.id, first.id],
    "The sidebar follows the new order"
  );

  removeAllWebPanels();
});

add_task(async function test_shortcut_toggles_last_panel() {
  const first = ZenWebPanelsStore.addPanel("https://example.com/");
  const second = ZenWebPanelsStore.addPanel("https://example.org/");

  const key = document.getElementById("zen-web-panels-toggle");
  is(key.getAttribute("command"), "cmd_zenWebPanelsToggle", "The key is wired");

  document.getElementById("cmd_zenWebPanelsToggle").doCommand();
  await TestUtils.waitForCondition(
    () => gZenWebPanels.activeBrowser?.currentURI.spec === first.url,
    "With nothing used yet, the first panel opens"
  );

  sidebarItemFor(second).doCommand();
  await TestUtils.waitForCondition(
    () => gZenWebPanels.activeBrowser?.currentURI.spec === second.url
  );
  document.getElementById("cmd_zenWebPanelsToggle").doCommand();
  ok(!gZenWebPanels.activeBrowser, "The shortcut closes the open panel");

  document.getElementById("cmd_zenWebPanelsToggle").doCommand();
  is(
    gZenWebPanels.activeBrowser?.currentURI.spec,
    second.url,
    "And reopens the last one used"
  );

  gZenWebPanels.hide();
  removeAllWebPanels();
});

add_task(async function test_windows_without_web_panels_ignore_shortcuts() {
  ZenWebPanelsStore.addPanel("https://example.com/");
  const win = await BrowserTestUtils.openNewBrowserWindow({ private: true });

  win.gZenWebPanels.toggleLast();
  win.gZenWebPanels.toggleIndex(0);
  ok(
    !win.document.getElementById("zen-web-panel"),
    "Private windows have no web panels to open"
  );

  await BrowserTestUtils.closeWindow(win);
  removeAllWebPanels();
});

add_task(async function test_sidebar_hides_with_tabs_in_compact_mode() {
  const entry = gZenCompactModeManager.hoverableElements.find(
    ({ element }) => element === sidebar()
  );
  ok(entry, "Compact mode reveals the sidebar on hover");
  is(
    entry.screenEdge,
    gZenCompactModeManager.sidebarIsOnRight ? "left" : "right",
    "From the edge opposite the tabs"
  );
});

// Compact mode keeps an element out while it has `has-popup-menu`.
add_task(async function test_popups_from_the_sidebar_keep_it_out() {
  const panel = ZenWebPanelsStore.addPanel("https://example.com/");
  const menu = document.getElementById("zen-web-panels-context");
  const editor = () => document.getElementById("zen-web-panels-editor");
  const nextFrame = () =>
    new Promise(resolve => requestAnimationFrame(resolve));

  const showing = BrowserTestUtils.waitForEvent(menu, "popupshowing");
  EventUtils.synthesizeMouseAtCenter(
    document.querySelector(".zen-web-panels-sidebar-add"),
    { type: "contextmenu", button: 2 }
  );
  await showing;
  await nextFrame();
  is(menu.state, "closed", "The + button has no context menu");
  ok(
    !sidebar().hasAttribute("has-popup-menu"),
    "So it doesn't hold the sidebar out"
  );

  const shown = BrowserTestUtils.waitForEvent(menu, "popupshown");
  EventUtils.synthesizeMouseAtCenter(sidebarItemFor(panel), {
    type: "contextmenu",
    button: 2,
  });
  await shown;
  ok(
    sidebar().hasAttribute("has-popup-menu"),
    "The context menu keeps the sidebar out"
  );

  menu.activateItem(document.getElementById("zen-web-panels-context-edit"));
  await TestUtils.waitForCondition(
    () => editor()?.state === "open",
    "Edit opens the editor"
  );
  await nextFrame();
  await nextFrame();
  is(editor().anchorNode, sidebarItemFor(panel), "Next to the panel's item");
  ok(
    sidebar().hasAttribute("has-popup-menu"),
    "The sidebar stays out while editing"
  );

  let hidden = BrowserTestUtils.waitForEvent(editor(), "popuphidden");
  editor().hidePopup();
  await hidden;
  await TestUtils.waitForCondition(
    () => !sidebar().hasAttribute("has-popup-menu"),
    "Closing the editor lets the sidebar hide again"
  );

  gZenWebPanels.show(panel.id);
  const more = document.getElementById("zen-web-panel-more");
  const moreMenu = more.querySelector("menupopup");
  const moreShown = BrowserTestUtils.waitForEvent(moreMenu, "popupshown");
  moreMenu.openPopup(more);
  await moreShown;
  moreMenu.activateItem(document.getElementById("zen-web-panel-edit"));
  await TestUtils.waitForCondition(
    () => editor().state === "open",
    "The header menu opens the editor too"
  );
  is(editor().anchorNode, more, "Below the header button");
  ok(
    !sidebar().hasAttribute("has-popup-menu"),
    "Without bringing the sidebar out"
  );

  hidden = BrowserTestUtils.waitForEvent(editor(), "popuphidden");
  editor().hidePopup();
  await hidden;
  gZenWebPanels.hide();
  removeAllWebPanels();
});

add_task(async function test_add_button_opens_the_editor_for_a_new_panel() {
  const editor = () => document.getElementById("zen-web-panels-editor");
  const field = selector => editor().querySelector(selector);
  const openEditor = async () => {
    document.querySelector(".zen-web-panels-sidebar-add").doCommand();
    await TestUtils.waitForCondition(
      () =>
        editor()?.state === "open" &&
        document.activeElement === field(".zen-web-panels-editor-url"),
      "The + button opens the editor, with the address focused"
    );
  };
  const addWithEnter = async input => {
    const hidden = BrowserTestUtils.waitForEvent(editor(), "popuphidden");
    input.focus();
    EventUtils.synthesizeKey("KEY_Enter");
    await hidden;
  };

  await BrowserTestUtils.withNewTab("about:blank", async () => {
    await openEditor();
    is(
      field(".zen-web-panels-editor-url").value,
      "",
      "Pages that can't be panels aren't suggested"
    );
    ok(!field(".zen-web-panels-editor-footer").hidden, "It offers to add");

    field(".zen-web-panels-editor-title").value = "Example";
    field('checkbox[option="floating"]').click();
    is(ZenWebPanelsStore.getPanels().length, 0, "Nothing is stored before Add");

    field(".zen-web-panels-editor-url").value = "file:///etc/passwd";
    field(".zen-web-panels-editor-add").doCommand();
    ok(
      !field(".zen-web-panels-editor-url-error").hidden,
      "A bad address shows an error"
    );
    is(ZenWebPanelsStore.getPanels().length, 0, "And isn't added");

    field(".zen-web-panels-editor-url").value = "example.com";
    await addWithEnter(field(".zen-web-panels-editor-title"));

    const [panel] = ZenWebPanelsStore.getPanels();
    is(panel?.url, "https://example.com/", "Enter in any field adds it");
    is(panel?.title, "Example", "With the name picked before adding");
    ok(panel?.floating, "And the options");
    is(
      gZenWebPanels.activeBrowser?.getAttribute("zen-web-panel-id"),
      panel?.id,
      "The new panel opens"
    );
  });

  gZenWebPanels.hide();
  removeAllWebPanels();

  await BrowserTestUtils.withNewTab("https://example.org/", async () => {
    ZenWebPanelsStore.addPanel("https://example.org/");
    await openEditor();
    is(
      field(".zen-web-panels-editor-url").value,
      "https://example.org/",
      "It starts with the selected tab's page"
    );

    await addWithEnter(field(".zen-web-panels-editor-url"));
    is(
      ZenWebPanelsStore.getPanels().filter(
        panel => panel.url === "https://example.org/"
      ).length,
      2,
      "Even a page that's already a panel is added again"
    );

    await openEditor();
    const hidden = BrowserTestUtils.waitForEvent(editor(), "popuphidden");
    editor().hidePopup();
    await hidden;
    is(ZenWebPanelsStore.getPanels().length, 2, "Closing it adds nothing");
  });

  gZenWebPanels.hide();
  removeAllWebPanels();
});

add_task(async function test_context_menu_removes_panel() {
  const panel = ZenWebPanelsStore.addPanel("https://example.com/");
  const menu = document.getElementById("zen-web-panels-context");

  const shown = BrowserTestUtils.waitForEvent(menu, "popupshown");
  EventUtils.synthesizeMouseAtCenter(sidebarItemFor(panel), {
    type: "contextmenu",
    button: 2,
  });
  await shown;
  ok(
    !document.getElementById("zen-web-panels-context-remove").hidden,
    "Items offer to be removed"
  );

  const hidden = BrowserTestUtils.waitForEvent(menu, "popuphidden");
  menu.activateItem(document.getElementById("zen-web-panels-context-remove"));
  await hidden;

  is(ZenWebPanelsStore.getPanels().length, 0, "The panel is gone");
  is(sidebarItems().length, 0, "And so is its item");
});
