// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { nsZenDOMOperatedFeature } from "chrome://browser/content/zen-components/ZenCommonUtils.mjs";
import { ZenWebPanelsStore } from "chrome://browser/content/zen-components/ZenWebPanelsStore.mjs";
import { nsZenWebPanelsEditor } from "chrome://browser/content/zen-components/ZenWebPanelsEditor.mjs";

const ENABLED_PREF = "zen.web-panels.enabled";
const WIDTH_PREF = "zen.web-panels.width";
const MIN_WIDTH = 260;
const MAX_WIDTH_RATIO = 0.7;
const MINUTE_MS = 60 * 1000;
const LAST_URL_SAVE_DELAY_MS = 1000;
// The sound indicator sits in this corner of a sidebar item, in pixels.
const SOUND_INDICATOR_SIZE = 14;
const LINK_DROP_TYPES = ["text/x-moz-url", "text/uri-list"];
const PANEL_DROP_TYPE = "application/x-zen-web-panel";
// Back, forward and reload keys go through these commands, which follow the
// selected tab: a disabled command drops its key.
const NAVIGATION_COMMANDS = [
  "Browser:Back",
  "Browser:Forward",
  "Browser:Reload",
];
// Popups that keep the sidebar out in compact mode when opened from it.
const SIDEBAR_POPUP_IDS = ["zen-web-panels-context", "zen-web-panels-editor"];

const containerOf = browser =>
  Number(browser.getAttribute("usercontextid")) || 0;

// Commands that act on the panel instead of the selected tab when they come
// from a shortcut while the panel has focus, or from the page context menu
// opened on the panel.
const PANEL_COMMANDS = {
  "Browser:Back": entry => entry.browser.goBack(),
  "Browser:Forward": entry => entry.browser.goForward(),
  "Browser:Reload": entry => entry.browser.reload(),
  "Browser:ReloadSkipCache": entry =>
    entry.browser.reloadWithFlags(
      Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_CACHE |
        Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_PROXY
    ),
  cmd_close: (entry, panels) => panels.hide(),
  cmd_find: (entry, panels) => panels.find(entry, "onFindCommand"),
  cmd_findAgain: (entry, panels) =>
    panels.find(entry, "onFindAgainCommand", false),
  cmd_findPrevious: (entry, panels) =>
    panels.find(entry, "onFindAgainCommand", true),
  cmd_fullZoomEnlarge: (entry, panels) => panels.zoom(entry, 1),
  cmd_fullZoomReduce: (entry, panels) => panels.zoom(entry, -1),
  cmd_fullZoomReset: (entry, panels) => panels.zoom(entry, 0),
};

/**
 * Web panels: sites docked next to the tab content, each one in its own
 * <browser>. The browsers are never tabs, so they stay out of the tab strip,
 * spaces, window sync and session restore.
 *
 * Every panel browser is created remote and loads its URL with a null
 * principal, the same way Firefox's chatbot sidebar does: page content never
 * runs in the parent process and can't be given chrome privileges.
 */
class nsZenWebPanels extends nsZenDOMOperatedFeature {
  /**
   * Loaded panels by id: the panel's options, its browser and what runs
   * around it (findbar, media controller, timers).
   *
   * @type {Map<string, object>}
   */
  #entries = new Map();
  // Opened with "Open Link in Temporary Web Panel": never stored, and
  // discarded as soon as they stop being visible.
  #temporaryPanels = new Map();
  #activeId = null;
  #host = null;
  #sidebar = null;
  #editor = null;
  #draggedItem = null;
  #selectedHost = null;
  #soundIndicatorPressed = false;
  #sidebarPopups = new Set();
  // The selected tab's navigation commands while a panel has focus.
  #tabCommandStates = null;

  init() {
    if (
      !Services.prefs.getBoolPref(ENABLED_PREF) ||
      PrivateBrowsingUtils.isWindowPrivate(window) ||
      !window.toolbar.visible
    ) {
      return;
    }

    this.#createHost();
    this.#createSidebar();
    this.#editor = new nsZenWebPanelsEditor();
    document.addEventListener("command", this, true);
    document.addEventListener("fullscreenchange", this);
    // Floating panels close when clicking anywhere else.
    window.addEventListener("mousedown", this, true);
    window.addEventListener("focus", this, true);
    Services.prefs.addObserver(ZenWebPanelsStore.PANELS_PREF, this);

    window.addEventListener(
      "unload",
      () => {
        Services.prefs.removeObserver(ZenWebPanelsStore.PANELS_PREF, this);

        for (const entry of this.#entries.values()) {
          this.#stopEntry(entry);
        }
      },
      { once: true }
    );

    window.delayedStartupPromise.then(() => {
      this.#insertContextMenuItems();
      gBrowser.addProgressListener({
        onLocationChange: () => this.#onSelectedLocationChange(),
      });
      this.#onSelectedLocationChange();
      this.#loadStartupPanels();
    });
  }

  /**
   * The panel browser on screen. PopupNotifications treats it as active, so
   * its permission prompts show up (see PopupNotifications-sys-mjs.patch).
   */
  get activeBrowser() {
    return this.#host?.hidden ? null : (this.#activeEntry?.browser ?? null);
  }

  get #activeEntry() {
    return this.#entries.get(this.#activeId);
  }

  /**
   * @param {string} id
   */
  toggle(id) {
    if (this.#activeId === id && !this.#host.hidden) {
      this.hide();
    } else {
      this.show(id);
    }
  }

  /**
   * Shows the panel used last, or the first one; hides it if it's open.
   */
  toggleLast() {
    if (this.activeBrowser) {
      this.hide();
      return;
    }

    const panels = ZenWebPanelsStore.getPanels();
    const lastUsed = panels.find(panel => panel.id === this.#activeId);
    const panel = lastUsed ?? panels[0];

    if (panel) {
      this.show(panel.id);
    }
  }

  /**
   * @param {number} index - The panel's position in the sidebar.
   */
  toggleIndex(index) {
    const panel = ZenWebPanelsStore.getPanels()[index];

    if (panel) {
      this.toggle(panel.id);
    }
  }

  /**
   * @param {string} id
   * @param {object} [options]
   * @param {boolean} [options.takeFocus] - Moves the focus into the panel.
   */
  show(id, { takeFocus = true } = {}) {
    const panel = this.#panelFor(id);

    // Private, popup and disabled windows have no host, but get the keys.
    if (!panel || !this.#host) {
      return;
    }

    const previousId = this.#host.hidden ? null : this.#activeId;
    const entry = this.#entries.get(id) ?? this.#createEntry(panel);

    for (const [otherId, other] of this.#entries) {
      other.container.hidden = otherId !== id;
    }

    clearTimeout(entry.unloadTimer);
    this.#activeId = id;
    this.#host.hidden = false;

    // Without the header there's no button to bring back the requests the
    // user put away, so showing the panel does.
    if (panel.hideHeader) {
      for (const notification of PopupNotifications.getNotificationsForBrowser(
        entry.browser
      )) {
        notification.dismissed = false;
      }
    }

    this.#applyLayout();

    if (entry.reloadOnShow) {
      entry.reloadOnShow = false;
      entry.browser.reload();
    }

    this.#updateHeader();
    this.#updateSidebar();

    if (takeFocus) {
      entry.browser.focus();
    }

    if (previousId && previousId !== id) {
      this.#leave(previousId);
    }
  }

  hide() {
    if (this.#host.hidden) {
      return;
    }

    // Otherwise the window would stay in fullscreen with the page gone.
    if (this.#host.contains(document.fullscreenElement)) {
      document.exitFullscreen();
    }

    const hadFocus = this.#host.contains(document.activeElement);
    this.#host.hidden = true;
    this.#updateSidebar();
    // The panel's prompts hide with it, and the tab's come back.
    PopupNotifications.anchorVisibilityChange();

    if (hadFocus) {
      gBrowser.selectedBrowser.focus();
    }

    this.#leave(this.#activeId);
  }

  /**
   * Destroys the panel's browser; showing the panel again loads it from scratch.
   *
   * @param {string} id
   */
  unload(id) {
    const entry = this.#entries.get(id);

    if (!entry) {
      return;
    }

    // Removed first, so hiding it below can't come back here.
    this.#entries.delete(id);

    if (id === this.#activeId) {
      this.hide();
      this.#activeId = null;
    }

    this.#stopEntry(entry);
    entry.browser.destroy();
    entry.container.remove();
    this.#updateSidebar();
  }

  /**
   * Called by LinkHandlerParent with the icon of the page a panel shows.
   *
   * @param {Element} browser
   * @param {string} iconURL
   */
  setIcon(browser, iconURL) {
    for (const entry of this.#entries.values()) {
      if (entry.browser === browser) {
        entry.icon = iconURL;
        this.#updateSidebar();

        if (entry === this.#activeEntry) {
          this.#updateHeader();
        }
      }
    }
  }

  /**
   * Shows the panel for a page, adding it first unless it's already one.
   *
   * @param {string} url
   * @param {number} userContextId
   */
  addPage(url, userContextId) {
    const normalized = ZenWebPanelsStore.normalizeURL(url);
    const existing = ZenWebPanelsStore.getPanels().find(
      panel => panel.url === normalized && panel.userContextId === userContextId
    );
    const panel =
      existing ?? ZenWebPanelsStore.addPanel(url, { userContextId });

    if (panel) {
      this.show(panel.id);
    }
  }

  /**
   * Opens a page in a panel that isn't stored and goes away once closed.
   *
   * @param {string} url
   * @param {number} userContextId
   */
  openTemporary(url, userContextId) {
    const panel = ZenWebPanelsStore.createPanel(url, { userContextId });

    if (!panel) {
      return;
    }

    panel.id = `temporary-${panel.id}`;
    this.#temporaryPanels.set(panel.id, panel);
    this.#renderSidebar();
    this.show(panel.id);
  }

  /**
   * Stores a temporary panel, keeping its browser and current page.
   *
   * @param {string} id
   */
  keepTemporary(id) {
    const entry = this.#entries.get(id);
    const temporary = this.#temporaryPanels.get(id);

    if (!entry || !temporary) {
      return;
    }

    const currentURL = entry.browser.currentURI.spec;
    // With what was set while temporary, like its zoom and width.
    const panel = ZenWebPanelsStore.addPanel(
      ZenWebPanelsStore.isAllowedURL(currentURL) ? currentURL : temporary.url,
      temporary
    );

    if (!panel) {
      return;
    }

    this.#temporaryPanels.delete(id);
    this.#entries.delete(id);
    entry.panel = panel;
    entry.browser.setAttribute("zen-web-panel-id", panel.id);
    this.#entries.set(panel.id, entry);

    if (this.#activeId === id) {
      this.#activeId = panel.id;
    }

    this.#renderSidebar();
    this.#updateHeader();
  }

  /**
   * Opens the editor for a stored panel.
   *
   * @param {string} id
   * @param {Element} [anchor] - What it opens from; its sidebar item by default.
   */
  edit(id, anchor = this.#sidebarItem(id)) {
    const panel = ZenWebPanelsStore.getPanel(id);

    if (panel) {
      this.#editor.open(panel, anchor);
    }
  }

  /**
   * @param {object} entry
   * @param {string} method - The findbar method a find command maps to.
   * @param {...any} args
   */
  async find(entry, method, ...args) {
    entry.findbar ??= this.#createFindbar(entry);

    const findbar = await entry.findbar;

    findbar[method](...args);
  }

  async #createFindbar(entry) {
    const findbar = document.createXULElement("findbar");
    entry.container.appendChild(findbar);
    // Same wait tabbrowser does before giving a new findbar its browser.
    await new Promise(resolve => requestAnimationFrame(resolve));
    findbar.browser = entry.browser;

    return findbar;
  }

  /**
   * @param {object} entry
   * @param {number} direction - 1 to zoom in, -1 to zoom out, 0 to reset.
   */
  zoom(entry, direction) {
    const current = ZoomManager.getZoomForBrowser(entry.browser);
    let next = 1;

    if (direction > 0) {
      next = ZoomManager.zoomValues.find(value => value > current + 0.001);
    } else if (direction < 0) {
      next = ZoomManager.zoomValues.findLast(value => value < current - 0.001);
    }

    if (next) {
      ZoomManager.setZoomForBrowser(entry.browser, next);
      this.#savePanel(entry, { zoom: next });
    }
  }

  handleEvent(event) {
    switch (event.type) {
      case "command": {
        this.#onCommand(event);
        break;
      }

      case "mousedown": {
        this.#onWindowMouseDown(event);
        break;
      }

      case "focus": {
        const entry = this.#activeEntry;

        if (
          entry &&
          !this.#host.hidden &&
          // The window itself gets focus events too.
          entry.container.contains(document.activeElement)
        ) {
          this.#enableNavigationCommands();
        } else {
          this.#restoreNavigationCommands();
        }

        break;
      }

      case "popupshowing": {
        this.#onPopupShowing(event);
        break;
      }

      case "popuphidden": {
        this.#onPopupHidden(event);
        break;
      }

      case "fullscreenchange": {
        // A panel's page in fullscreen takes the window, like a tab's does.
        document.documentElement.toggleAttribute(
          "zen-web-panel-fullscreen",
          this.#host.contains(document.fullscreenElement)
        );
        break;
      }
    }
  }

  observe(subject, topic, data) {
    if (data !== ZenWebPanelsStore.PANELS_PREF) {
      return;
    }

    const panels = new Map(
      ZenWebPanelsStore.getPanels().map(panel => [panel.id, panel])
    );

    for (const [id, entry] of this.#entries) {
      if (this.#temporaryPanels.has(id)) {
        continue;
      }

      const next = panels.get(id);

      if (!next) {
        this.unload(id);
        continue;
      }

      // These only take effect in a new browser.
      if (
        next.url !== entry.panel.url ||
        next.userContextId !== entry.panel.userContextId ||
        next.mobile !== entry.panel.mobile
      ) {
        const wasVisible = this.activeBrowser === entry.browser;
        // The focus stays where it was: in the panel, or in the editor or
        // other window the change came from.
        const hadFocus =
          wasVisible && this.#host.contains(document.activeElement);
        this.unload(id);

        if (wasVisible) {
          this.show(id, { takeFocus: hadFocus });
        }

        continue;
      }

      entry.panel = next;
      this.#applyZoom(entry);
      this.#schedulePeriodicReload(entry);
    }

    if (this.activeBrowser) {
      this.#applyLayout();
      this.#updateHeader();
    }

    this.#renderSidebar();
  }

  #allPanels() {
    return [
      ...ZenWebPanelsStore.getPanels(),
      ...this.#temporaryPanels.values(),
    ];
  }

  #panelFor(id) {
    return this.#allPanels().find(panel => panel.id === id) ?? null;
  }

  /**
   * Saves a panel option; temporary panels keep it in memory.
   *
   * @param {object} entry
   * @param {object} changes
   */
  #savePanel(entry, changes) {
    if (this.#temporaryPanels.has(entry.panel.id)) {
      Object.assign(entry.panel, changes);
    } else {
      ZenWebPanelsStore.updatePanel(entry.panel.id, changes);
    }
  }

  /**
   * Runs when a panel stops being visible.
   *
   * @param {string} id
   */
  #leave(id) {
    if (this.#temporaryPanels.has(id)) {
      this.#temporaryPanels.delete(id);
      this.unload(id);
      this.#renderSidebar();

      return;
    }

    const entry = this.#entries.get(id);
    const minutes = entry?.panel.unloadAfter;

    if (!minutes) {
      return;
    }

    clearTimeout(entry.unloadTimer);
    entry.unloadTimer = setTimeout(() => {
      if (this.activeBrowser !== entry.browser) {
        this.unload(id);
      }
    }, minutes * MINUTE_MS);
  }

  #stopEntry(entry) {
    clearTimeout(entry.unloadTimer);
    clearTimeout(entry.lastURLTimer);
    clearInterval(entry.reloadTimer);
    // Controller listeners would otherwise keep a closed window alive.
    entry.mediaController?.removeEventListener(
      "audiblechange",
      entry.onAudibleChange
    );
  }

  #applyLayout() {
    const panel = this.#activeEntry?.panel;

    if (!panel) {
      return;
    }

    const width = panel.width || Services.prefs.getIntPref(WIDTH_PREF);
    this.#host.style.width = `${this.#clampWidth(width)}px`;
    this.#host.toggleAttribute("floating", panel.floating);
    this.#host.toggleAttribute("hide-header", panel.hideHeader);

    // Permission prompts point at the header, or at the top of the page
    // while the header is hidden, and show again with their panel.
    this.#activeEntry.browser.popupnotificationanchor = document.getElementById(
      panel.hideHeader
        ? "zen-web-panel-notification-fallback"
        : "zen-web-panel-notification-anchor"
    );
    PopupNotifications.anchorVisibilityChange();
    this.#updatePermissionAnchor();
  }

  /**
   * Shows the header button that brings back the visible panel's permission
   * requests while it has any. PopupNotifications marks the button when a
   * request shows, but only clears the marks of anchors in the urlbar.
   */
  #updatePermissionAnchor() {
    const browser = this.activeBrowser;

    document
      .getElementById("zen-web-panel-notification-anchor")
      .toggleAttribute(
        "showing",
        Boolean(
          browser &&
          PopupNotifications.getNotificationsForBrowser(browser).length
        )
      );
  }

  #applyZoom(entry) {
    const { browser, panel } = entry;

    if (Math.abs(ZoomManager.getZoomForBrowser(browser) - panel.zoom) > 0.001) {
      ZoomManager.setZoomForBrowser(browser, panel.zoom);
    }
  }

  #schedulePeriodicReload(entry) {
    clearInterval(entry.reloadTimer);
    entry.reloadTimer = null;

    if (entry.panel.reloadEvery) {
      entry.reloadTimer = setInterval(
        () => entry.browser.reload(),
        entry.panel.reloadEvery * MINUTE_MS
      );
    }
  }

  /**
   * Remembers where a panel is, for the "restore last page" option.
   *
   * @param {object} entry
   * @param {nsIURI} uri
   */
  #rememberPage(entry, uri) {
    const spec = uri?.spec;

    // Sites like Gmail change the URL constantly; save once it settles,
    // and not at all if it settles back on the saved page.
    clearTimeout(entry.lastURLTimer);

    if (
      !entry.panel.restoreLastPage ||
      this.#temporaryPanels.has(entry.panel.id) ||
      !ZenWebPanelsStore.isAllowedURL(spec) ||
      spec === entry.panel.lastURL
    ) {
      return;
    }

    entry.lastURLTimer = setTimeout(
      () => ZenWebPanelsStore.updatePanel(entry.panel.id, { lastURL: spec }),
      LAST_URL_SAVE_DELAY_MS
    );
  }

  #loadStartupPanels() {
    // Only the first window: a second copy of a chat app would log out the
    // first one. Windows restored with the session finish starting in any
    // order, so this goes by the order they were opened in.
    const [firstWindow] = [
      ...Services.wm.getEnumerator("navigator:browser"),
    ].filter(
      browserWindow =>
        !PrivateBrowsingUtils.isWindowPrivate(browserWindow) &&
        browserWindow.toolbar.visible
    );

    if (firstWindow !== window) {
      return;
    }

    for (const panel of ZenWebPanelsStore.getPanels()) {
      if (panel.loadOnStartup && !this.#entries.has(panel.id)) {
        this.#createEntry(panel);
      }
    }
  }

  #onSelectedLocationChange() {
    // The tab just set its own commands; keep them for when the panel
    // loses focus.
    if (this.#tabCommandStates) {
      this.#tabCommandStates = null;
      this.#enableNavigationCommands();
    }

    let host = "";

    try {
      host = gBrowser.currentURI.host;
    } catch {
      // about: pages have no host.
    }

    if (host === this.#selectedHost) {
      return;
    }

    this.#selectedHost = host;

    for (const entry of this.#entries.values()) {
      if (!entry.panel.reloadOnTabChange) {
        continue;
      }

      if (entry.browser === this.activeBrowser) {
        entry.browser.reload();
      } else {
        entry.reloadOnShow = true;
      }
    }
  }

  /**
   * While a panel has focus, its back, forward and reload keys work even when
   * the selected tab can't do those. The toolbar buttons share the commands
   * and keep acting on the tab, which at worst does nothing.
   */
  #enableNavigationCommands() {
    this.#tabCommandStates ??= new Map(
      NAVIGATION_COMMANDS.map(id => [
        id,
        document.getElementById(id).hasAttribute("disabled"),
      ])
    );

    for (const id of NAVIGATION_COMMANDS) {
      document.getElementById(id).removeAttribute("disabled");
    }
  }

  #restoreNavigationCommands() {
    if (!this.#tabCommandStates) {
      return;
    }

    for (const [id, disabled] of this.#tabCommandStates) {
      if (disabled) {
        document.getElementById(id).setAttribute("disabled", "true");
      }
    }

    this.#tabCommandStates = null;
  }

  #onCommand(event) {
    const handler = PANEL_COMMANDS[event.target.id];
    const entry = handler && this.#commandTarget(event);

    if (!entry) {
      return;
    }

    event.stopPropagation();
    handler(entry, this);
  }

  /**
   * Keeps the sidebar out in compact mode while its context menu, or the
   * editor opened from it, is up. gZenUIManager only tracks popups that live
   * inside the element, and these live in #mainPopupSet.
   *
   * @param {Event} event
   */
  #onPopupShowing(event) {
    const popup = event.target;
    const source = popup.anchorNode ?? popup.triggerNode;

    if (
      event.defaultPrevented ||
      !SIDEBAR_POPUP_IDS.includes(popup.id) ||
      !this.#sidebar.contains(source)
    ) {
      return;
    }

    this.#sidebarPopups.add(popup);
    gZenCompactModeManager._setElementExpandAttribute(
      this.#sidebar,
      true,
      "has-popup-menu"
    );
  }

  #onPopupHidden(event) {
    // A request was answered or put away.
    if (event.target.id === "notification-popup") {
      this.#updatePermissionAnchor();
      return;
    }

    if (!this.#sidebarPopups.delete(event.target)) {
      return;
    }

    // Edit closes the context menu right before the editor opens.
    requestAnimationFrame(() => {
      if (!this.#sidebarPopups.size) {
        gZenCompactModeManager._setElementExpandAttribute(
          this.#sidebar,
          false,
          "has-popup-menu"
        );
      }
    });
  }

  #onWindowMouseDown(event) {
    if (!this.activeBrowser || !this.#activeEntry.panel.floating) {
      return;
    }

    const { target } = event;

    if (
      this.#host.contains(target) ||
      this.#sidebar.contains(target) ||
      target.closest?.("panel, menupopup")
    ) {
      return;
    }

    this.hide();
  }

  /**
   * The panel a command should act on, if any. Toolbar buttons and menus keep
   * acting on the selected tab even while the panel has focus.
   *
   * @param {Event} event
   */
  #commandTarget(event) {
    const entry = this.#activeEntry;

    if (!entry || this.#host.hidden) {
      return null;
    }

    const source = event.sourceEvent?.target;

    if (source?.closest?.("#contentAreaContextMenu")) {
      return gContextMenu?.browser === entry.browser ? entry : null;
    }

    if (source?.localName !== "key") {
      return null;
    }

    return entry.container.contains(document.activeElement) ? entry : null;
  }

  #createHost() {
    this.#host = window.MozXULElement.parseXULToFragment(`
      <vbox id="zen-web-panel" hidden="true">
        <html:div class="zen-web-panel-resizer" role="separator" aria-orientation="vertical"/>
        <hbox class="zen-web-panel-header" align="center">
          <toolbarbutton id="zen-web-panel-back" class="toolbarbutton-1" data-l10n-id="zen-web-panel-back" disabled="true"/>
          <toolbarbutton id="zen-web-panel-forward" class="toolbarbutton-1" data-l10n-id="zen-web-panel-forward" disabled="true"/>
          <toolbarbutton id="zen-web-panel-reload" class="toolbarbutton-1" data-l10n-id="zen-web-panel-reload"/>
          <image id="zen-web-panel-icon"/>
          <label id="zen-web-panel-title" crop="end" flex="1"/>
          <toolbarbutton id="zen-web-panel-notification-anchor" class="toolbarbutton-1" data-l10n-id="zen-web-panel-permissions"/>
          <toolbarbutton id="zen-web-panel-more" class="toolbarbutton-1" type="menu" data-l10n-id="zen-web-panel-more">
            <menupopup id="zen-web-panel-more-menu">
              <menuitem id="zen-web-panel-open-in-tab" data-l10n-id="zen-web-panel-open-in-tab"/>
              <menuitem id="zen-web-panel-copy-link" data-l10n-id="zen-web-panel-copy-link"/>
              <menuitem id="zen-web-panel-go-home" data-l10n-id="zen-web-panel-go-home"/>
              <menuseparator/>
              <menuitem id="zen-web-panel-mobile" type="checkbox" data-l10n-id="zen-web-panel-mobile"/>
              <menuitem id="zen-web-panel-keep" data-l10n-id="zen-web-panel-keep"/>
              <menuitem id="zen-web-panel-edit" data-l10n-id="zen-web-panels-context-edit"/>
            </menupopup>
          </toolbarbutton>
          <toolbarbutton id="zen-web-panel-close" class="toolbarbutton-1" data-l10n-id="zen-web-panel-close"/>
        </hbox>
        <vbox class="zen-web-panel-browsers" flex="1">
          <!-- Permission prompts point here while the header is hidden. -->
          <box id="zen-web-panel-notification-fallback"/>
        </vbox>
      </vbox>
    `).firstElementChild;

    const header = this.#host.querySelector(".zen-web-panel-header");
    const actions = {
      "zen-web-panel-back": entry => entry.browser.goBack(),
      "zen-web-panel-forward": entry => entry.browser.goForward(),
      "zen-web-panel-reload": entry => entry.browser.reload(),
      "zen-web-panel-close": () => this.hide(),
      // Shown by PopupNotifications while the panel has a request.
      "zen-web-panel-notification-anchor": entry =>
        PopupNotifications._reshowNotifications(
          document.getElementById("zen-web-panel-notification-anchor"),
          entry.browser
        ),
      "zen-web-panel-open-in-tab": entry => {
        gBrowser.selectedTab = gBrowser.addTab(entry.browser.currentURI.spec, {
          triggeringPrincipal: entry.browser.contentPrincipal,
          userContextId: containerOf(entry.browser),
        });
      },
      "zen-web-panel-copy-link": entry =>
        Cc["@mozilla.org/widget/clipboardhelper;1"]
          .getService(Ci.nsIClipboardHelper)
          .copyString(entry.browser.currentURI.spec),
      "zen-web-panel-go-home": entry => this.#loadPage(entry, entry.panel.url),
      "zen-web-panel-mobile": entry =>
        ZenWebPanelsStore.updatePanel(entry.panel.id, {
          mobile: !entry.panel.mobile,
        }),
      "zen-web-panel-keep": entry => this.keepTemporary(entry.panel.id),
      "zen-web-panel-edit": entry =>
        this.edit(
          entry.panel.id,
          document.getElementById("zen-web-panel-more")
        ),
    };

    header.addEventListener("command", event => {
      const entry = this.#activeEntry;

      if (entry) {
        actions[event.target.id]?.(entry);
      }
    });

    header
      .querySelector("#zen-web-panel-more-menu")
      .addEventListener("popupshowing", event => {
        const entry = this.#activeEntry;

        if (!entry || event.target !== event.currentTarget) {
          return;
        }

        const isTemporary = this.#temporaryPanels.has(entry.panel.id);
        const mobile = document.getElementById("zen-web-panel-mobile");

        document.getElementById("zen-web-panel-keep").hidden = !isTemporary;
        document.getElementById("zen-web-panel-edit").hidden = isTemporary;
        mobile.hidden = isTemporary;
        mobile.toggleAttribute("checked", entry.panel.mobile);
      });

    this.#host
      .querySelector(".zen-web-panel-resizer")
      .addEventListener("pointerdown", event => this.#onResizeStart(event));

    document.getElementById("tabbrowser-tabbox").appendChild(this.#host);
  }

  /**
   * The column of panels at the window edge opposite the tabs. In compact
   * mode it hides with the tabs and slides in on hover, through
   * gZenCompactModeManager.hoverableElements.
   */
  #createSidebar() {
    this.#sidebar = window.MozXULElement.parseXULToFragment(`
      <vbox id="zen-web-panels-sidebar" context="zen-web-panels-context">
        <vbox class="zen-web-panels-sidebar-content" flex="1">
          <vbox class="zen-web-panels-sidebar-list"/>
          <!-- Badged like the items: outside a toolbar, only the badge
               stack paints context-fill icons. -->
          <toolbarbutton class="toolbarbutton-1 zen-web-panels-sidebar-add"
                         badged="true"
                         data-l10n-id="zen-web-panels-add"/>
        </vbox>
      </vbox>
    `).firstElementChild;

    const list = this.#sidebar.querySelector(".zen-web-panels-sidebar-list");

    list.addEventListener("click", event => this.#onItemClick(event));
    list.addEventListener("command", event => {
      const id = event.target.getAttribute("zen-web-panel-id");

      if (this.#soundIndicatorPressed) {
        this.#soundIndicatorPressed = false;
        return;
      }

      if (id) {
        this.toggle(id);
      }
    });

    this.#sidebar
      .querySelector(".zen-web-panels-sidebar-add")
      .addEventListener("command", event => this.#addNew(event.target));

    list.addEventListener("dragstart", event => this.#onDragStart(event));
    this.#sidebar.addEventListener("dragover", event =>
      this.#onDragOver(event)
    );
    this.#sidebar.addEventListener("dragleave", event => {
      if (!this.#sidebar.contains(event.relatedTarget)) {
        this.#sidebar.removeAttribute("drop-target");
      }
    });
    this.#sidebar.addEventListener("drop", event => this.#onDrop(event));
    list.addEventListener("dragend", () => {
      this.#draggedItem = null;
      this.#renderSidebar();
    });

    document.getElementById("browser").appendChild(this.#sidebar);

    const popupSet = document.getElementById("mainPopupSet");

    popupSet.addEventListener("popupshowing", this);
    popupSet.addEventListener("popuphidden", this);

    this.#createSidebarContextMenu();
    this.#renderSidebar();
  }

  #sidebarItem(id) {
    return this.#sidebar.querySelector(
      `.zen-web-panels-sidebar-item[zen-web-panel-id="${CSS.escape(id)}"]`
    );
  }

  #renderSidebar() {
    const items = this.#allPanels().map(panel => {
      const item = document.createXULElement("toolbarbutton");
      const label = panel.title || this.#labelFor(panel.url);
      const isTemporary = this.#temporaryPanels.has(panel.id);

      item.className = "toolbarbutton-1 zen-web-panels-sidebar-item";
      item.setAttribute("zen-web-panel-id", panel.id);
      // Hidden by the sidebar's CSS, but it's the item's accessible name.
      item.setAttribute("label", label);
      item.setAttribute("tooltiptext", label);
      item.setAttribute("badged", "true");

      if (isTemporary) {
        item.setAttribute("temporary", "true");
      } else {
        item.setAttribute("draggable", "true");
      }

      return item;
    });

    this.#sidebar
      .querySelector(".zen-web-panels-sidebar-list")
      .replaceChildren(...items);
    this.#updateSidebar();
  }

  /**
   * Refreshes each item's icon, badge, sound indicator and open state.
   */
  #updateSidebar() {
    const panels = new Map(this.#allPanels().map(panel => [panel.id, panel]));

    for (const item of this.#sidebar.querySelectorAll(
      ".zen-web-panels-sidebar-item"
    )) {
      const id = item.getAttribute("zen-web-panel-id");
      const panel = panels.get(id);
      const entry = this.#entries.get(id);

      if (!panel) {
        continue;
      }

      const isMuted = Boolean(entry?.mediaController?.isMuted);

      item.setAttribute("image", this.#iconFor(panel));
      item.checked = id === this.#activeId && !this.#host.hidden;
      item.toggleAttribute("soundplaying", Boolean(entry?.audible) && !isMuted);
      item.toggleAttribute("muted", isMuted);

      if (entry?.badge && !panel.hideBadge) {
        item.setAttribute("badge", entry.badge);
      } else {
        item.removeAttribute("badge");
      }
    }
  }

  /**
   * The + button opens the editor for a new panel. It starts with the
   * selected tab's page, so adding that is one Enter away.
   *
   * @param {Element} button
   */
  #addNew(button) {
    const currentURL = gBrowser.currentURI.spec;
    const isAllowed = ZenWebPanelsStore.isAllowedURL(currentURL);

    this.#editor.openNew(
      {
        url: isAllowed ? currentURL : "",
        userContextId: isAllowed ? gBrowser.selectedTab.userContextId : 0,
      },
      button,
      panel => this.show(panel.id)
    );
  }

  /**
   * A click on the sound indicator mutes the panel instead of toggling it.
   * The item's command comes after the click listeners, so the flag set here
   * is always consumed by it.
   *
   * @param {MouseEvent} event
   */
  #onItemClick(event) {
    const item = event.target.closest?.(".zen-web-panels-sidebar-item");

    if (event.button !== 0 || !item?.matches("[soundplaying], [muted]")) {
      return;
    }

    const bounds = item.getBoundingClientRect();
    const inIndicator =
      event.clientX >= bounds.right - SOUND_INDICATOR_SIZE &&
      event.clientY >= bounds.bottom - SOUND_INDICATOR_SIZE;

    if (!inIndicator) {
      return;
    }

    this.#soundIndicatorPressed = true;
    this.#toggleMute(item.getAttribute("zen-web-panel-id"));
  }

  #toggleMute(id) {
    const controller = this.#entries.get(id)?.mediaController;

    if (!controller) {
      return;
    }

    if (controller.isMuted) {
      controller.unmute();
    } else {
      controller.mute();
    }

    this.#updateSidebar();
  }

  #createSidebarContextMenu() {
    const popup = window.MozXULElement.parseXULToFragment(`
      <menupopup id="zen-web-panels-context">
        <menuitem id="zen-web-panels-context-edit"
                  data-l10n-id="zen-web-panels-context-edit"/>
        <menuitem id="zen-web-panels-context-mute"/>
        <menuitem id="zen-web-panels-context-unload"
                  data-l10n-id="zen-web-panels-context-unload"/>
        <menuitem id="zen-web-panels-context-remove"
                  data-l10n-id="zen-web-panels-context-remove"/>
      </menupopup>
    `).firstElementChild;

    const targetId = () =>
      popup.triggerNode
        ?.closest(".zen-web-panels-sidebar-item")
        ?.getAttribute("zen-web-panel-id");

    popup.addEventListener("popupshowing", event => {
      if (event.target !== popup) {
        return;
      }

      const id = targetId();

      // Every item acts on a panel; the + button and empty space have none.
      if (!id) {
        event.preventDefault();
        return;
      }

      const isStored = !this.#temporaryPanels.has(id);
      const controller = this.#entries.get(id)?.mediaController;
      const mute = popup.querySelector("#zen-web-panels-context-mute");

      popup.querySelector("#zen-web-panels-context-edit").hidden = !isStored;
      popup.querySelector("#zen-web-panels-context-remove").hidden = !isStored;
      popup.querySelector("#zen-web-panels-context-unload").disabled =
        !this.#entries.has(id);

      mute.hidden = !controller;
      document.l10n.setAttributes(
        mute,
        controller?.isMuted
          ? "zen-web-panels-context-unmute"
          : "zen-web-panels-context-mute"
      );
    });

    const actions = {
      "zen-web-panels-context-edit": () => this.edit(targetId()),
      "zen-web-panels-context-mute": () => this.#toggleMute(targetId()),
      "zen-web-panels-context-unload": () => this.unload(targetId()),
      "zen-web-panels-context-remove": () =>
        ZenWebPanelsStore.removePanel(targetId()),
    };

    popup.addEventListener("command", event => actions[event.target.id]?.());

    document.getElementById("mainPopupSet").appendChild(popup);
  }

  #onDragStart(event) {
    const item = event.target.closest?.(
      ".zen-web-panels-sidebar-item[draggable]"
    );

    if (!item) {
      return;
    }

    this.#draggedItem = item;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      PANEL_DROP_TYPE,
      item.getAttribute("zen-web-panel-id")
    );
  }

  #onDragOver(event) {
    if (this.#draggedItem) {
      this.#moveDraggedItem(event);
      return;
    }

    const { types } = event.dataTransfer;

    if (
      !types.includes(TAB_DROP_TYPE) &&
      !LINK_DROP_TYPES.some(type => types.includes(type))
    ) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "link";
    this.#sidebar.setAttribute("drop-target", "true");
  }

  #moveDraggedItem(event) {
    const target = event.target.closest?.(
      ".zen-web-panels-sidebar-item[draggable]"
    );

    event.preventDefault();

    if (!target || target === this.#draggedItem) {
      return;
    }

    const bounds = target.getBoundingClientRect();

    if (event.clientY < bounds.top + bounds.height / 2) {
      target.before(this.#draggedItem);
    } else {
      target.after(this.#draggedItem);
    }
  }

  #onDrop(event) {
    this.#sidebar.removeAttribute("drop-target");

    if (this.#draggedItem) {
      event.preventDefault();

      const list = this.#sidebar.querySelector(".zen-web-panels-sidebar-list");

      ZenWebPanelsStore.reorderPanels(
        [...list.children].map(item => item.getAttribute("zen-web-panel-id"))
      );

      return;
    }

    const page = this.#droppedPage(event.dataTransfer);

    if (page) {
      event.preventDefault();
      this.addPage(page.url, page.userContextId);
    }
  }

  /**
   * The page a dropped tab or link points to. The store still validates it.
   *
   * @param {DataTransfer} dataTransfer
   * @returns {{url: string, userContextId: number}|null}
   */
  #droppedPage(dataTransfer) {
    if (dataTransfer.types.includes(TAB_DROP_TYPE)) {
      const tab = dataTransfer.mozGetDataAt(TAB_DROP_TYPE, 0);

      if (tab?.linkedBrowser) {
        return {
          url: tab.linkedBrowser.currentURI.spec,
          userContextId: tab.userContextId,
        };
      }
    }

    for (const type of LINK_DROP_TYPES) {
      const data = dataTransfer.getData(type);

      if (data) {
        return {
          url: data.split("\n")[0].trim(),
          userContextId: gBrowser.selectedTab.userContextId,
        };
      }
    }

    return null;
  }

  /**
   * The unread count sites put at the start of their title, like
   * "(3) WhatsApp". Anywhere else it's often something else, like a year.
   *
   * @param {string} title
   * @returns {string}
   */
  #badgeFor(title) {
    return /^\((\d+)\+?\)/.exec(title ?? "")?.[1] ?? "";
  }

  /**
   * Tab, page and link context menu entries. The page and link ones are shown
   * by nsContextMenu (see nsContextMenu-sys-mjs.patch).
   */
  #insertContextMenuItems() {
    const items = [
      {
        id: "context-zenOpenLinkInWebPanel",
        l10n: "zen-web-panels-context-open-link",
        after: "context-zenOpenLinkInGlance",
        before: "context-sep-open",
        command: () =>
          this.addPage(gContextMenu.linkURL, containerOf(gContextMenu.browser)),
      },
      {
        id: "context-zenOpenLinkInTemporaryWebPanel",
        l10n: "zen-web-panels-context-open-link-temporary",
        after: "context-zenOpenLinkInWebPanel",
        before: "context-sep-open",
        command: () =>
          this.openTemporary(
            gContextMenu.linkURL,
            containerOf(gContextMenu.browser)
          ),
      },
      {
        id: "context-zenAddPageToWebPanels",
        l10n: "zen-web-panels-context-add-page",
        after: "context-savepage",
        command: () =>
          this.addPage(
            gContextMenu.browser.currentURI.spec,
            containerOf(gContextMenu.browser)
          ),
      },
      {
        id: "context_zenAddTabToWebPanels",
        l10n: "tab-context-zen-add-to-web-panels",
        after: "context_zen-add-essential",
        before: "context_pinTab",
        command: () => {
          const tab = TabContextMenu.contextTab;
          const tabs = tab.multiselected ? gBrowser.selectedTabs : [tab];

          for (const { linkedBrowser, userContextId } of tabs) {
            this.addPage(linkedBrowser.currentURI.spec, userContextId);
          }
        },
      },
    ];

    for (const { id, l10n, after, before, command } of items) {
      const item = document.createXULElement("menuitem");
      item.id = id;
      item.hidden = true;
      document.l10n.setAttributes(item, l10n);
      item.addEventListener("command", command);

      // The Zen anchors are missing when Glance or Essentials are disabled.
      const anchor = document.getElementById(after);

      if (anchor) {
        anchor.after(item);
      } else {
        document.getElementById(before).before(item);
      }
    }

    const tabMenu = document.getElementById("tabContextMenu");

    tabMenu.addEventListener("popupshowing", event => {
      if (event.target !== tabMenu) {
        return;
      }

      const tab = TabContextMenu.contextTab;
      const tabs = tab.multiselected ? gBrowser.selectedTabs : [tab];

      document.getElementById("context_zenAddTabToWebPanels").hidden =
        !tabs.some(({ linkedBrowser }) =>
          ZenWebPanelsStore.isAllowedURL(linkedBrowser.currentURI.spec)
        );
    });
  }

  #iconFor(panel) {
    return (
      panel.icon ||
      this.#entries.get(panel.id)?.icon ||
      `page-icon:${panel.url}`
    );
  }

  #labelFor(url) {
    try {
      return Services.io.newURI(url).host.replace(/^www\./, "");
    } catch {
      return url;
    }
  }

  #createEntry(panel) {
    const container = document.createXULElement("vbox");
    container.className = "zen-web-panel-container";
    container.setAttribute("flex", "1");
    // Shown by show(); panels loaded at startup stay in the background.
    container.hidden = true;

    const userContextId = ContextualIdentityService.getPublicIdentityFromId(
      panel.userContextId
    )
      ? panel.userContextId
      : 0;

    const browser = document.createXULElement("browser");
    const attributes = {
      type: "content",
      remote: "true",
      maychangeremoteness: "true",
      nodefaultsrc: "true",
      messagemanagergroup: "browsers",
      disableglobalhistory: "true",
      autocompletepopup: "PopupAutoComplete",
      tooltip: "aHTMLTooltip",
      contextmenu: "contentAreaContextMenu",
      flex: "1",
      "zen-web-panel-id": panel.id,
    };

    if (userContextId) {
      attributes.usercontextid = userContextId;
    }

    for (const [attribute, value] of Object.entries(attributes)) {
      browser.setAttribute(attribute, value);
    }

    container.appendChild(browser);
    this.#host.querySelector(".zen-web-panel-browsers").appendChild(container);

    const entry = { panel, container, browser };
    entry.listener = {
      QueryInterface: ChromeUtils.generateQI([
        "nsIWebProgressListener",
        "nsISupportsWeakReference",
      ]),
      onLocationChange: (webProgress, request, uri, flags) => {
        this.#watchAudio(entry);
        this.#applyZoom(entry);

        if (webProgress?.isTopLevel) {
          this.#rememberPage(entry, uri);
        }

        // Requests from the previous page go away, like they do for tabs.
        // PopupNotifications is lazy: there's nothing to clear before it's
        // been created.
        if (
          webProgress?.isTopLevel &&
          !(flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT) &&
          !Object.getOwnPropertyDescriptor(window, "PopupNotifications").get
        ) {
          PopupNotifications.locationChange(browser);

          if (entry === this.#activeEntry) {
            this.#updatePermissionAnchor();
          }
        }

        if (entry === this.#activeEntry) {
          this.#updateHeader();
        }
      },
    };

    browser.addProgressListener(
      entry.listener,
      Ci.nsIWebProgress.NOTIFY_LOCATION
    );

    browser.addEventListener("pagetitlechanged", () => {
      entry.badge = this.#badgeFor(browser.contentTitle);
      this.#updateSidebar();

      if (entry === this.#activeEntry) {
        this.#updateHeader();
      }
    });

    // The media controls follow tabs' "soundplaying"; panels report directly.
    entry.onAudibleChange = () => {
      entry.audible = entry.mediaController.isAudible;
      this.#updateSidebar();

      if (entry.audible) {
        window.gZenMediaController?.onAudioPlaybackStarted(browser);
      } else {
        window.gZenMediaController?.onAudioPlaybackStopped();
      }
    };

    this.#entries.set(panel.id, entry);

    if (panel.mobile) {
      browser.browsingContext.customUserAgent = this.#mobileUserAgent();
    }

    const url =
      panel.restoreLastPage && panel.lastURL ? panel.lastURL : panel.url;

    if (ZenWebPanelsStore.isAllowedURL(url)) {
      this.#loadPage(entry, url);
    }

    this.#watchAudio(entry);
    this.#applyZoom(entry);
    this.#schedulePeriodicReload(entry);

    return entry;
  }

  /**
   * Loads a page with a null principal from the browser's own container, so
   * the page can't inherit privileges from whatever started the load.
   *
   * @param {object} entry
   * @param {string} url
   */
  #loadPage(entry, url) {
    entry.browser.loadURI(Services.io.newURI(url), {
      triggeringPrincipal: Services.scriptSecurityManager.createNullPrincipal({
        userContextId: containerOf(entry.browser),
      }),
    });
  }

  /**
   * Listens to the media controller of the panel's current browsing
   * context; a process switch can replace it.
   *
   * @param {object} entry
   */
  #watchAudio(entry) {
    const controller = entry.browser.browsingContext?.mediaController;

    if (!controller || controller === entry.mediaController) {
      return;
    }

    entry.mediaController?.removeEventListener(
      "audiblechange",
      entry.onAudibleChange
    );
    entry.mediaController = controller;
    controller.addEventListener("audiblechange", entry.onAudibleChange);
  }

  #mobileUserAgent() {
    const version = parseInt(Services.appinfo.platformVersion);

    return `Mozilla/5.0 (Android 15; Mobile; rv:${version}.0) Gecko/${version}.0 Firefox/${version}.0`;
  }

  #updateHeader() {
    const entry = this.#activeEntry;

    if (!entry) {
      return;
    }

    const { browser, panel } = entry;

    document.getElementById("zen-web-panel-icon").src = this.#iconFor(panel);
    document.getElementById("zen-web-panel-title").value =
      browser.contentTitle || panel.title || this.#labelFor(panel.url);
    document.getElementById("zen-web-panel-back").disabled = !browser.canGoBack;
    document.getElementById("zen-web-panel-forward").disabled =
      !browser.canGoForward;
  }

  #clampWidth(width) {
    const max = Math.max(MIN_WIDTH, window.innerWidth * MAX_WIDTH_RATIO);

    return Math.round(Math.min(Math.max(width, MIN_WIDTH), max));
  }

  #onResizeStart(event) {
    if (event.button !== 0) {
      return;
    }

    const resizer = event.currentTarget;
    resizer.setPointerCapture(event.pointerId);

    const startX = event.screenX;
    const startWidth = this.#host.getBoundingClientRect().width;

    // The panel grows toward its resizer, whichever side and direction.
    const hostBounds = this.#host.getBoundingClientRect();
    const direction =
      resizer.getBoundingClientRect().left <
      hostBounds.left + hostBounds.width / 2
        ? -1
        : 1;
    let width = startWidth;

    const onMove = moveEvent => {
      width = this.#clampWidth(
        startWidth + direction * (moveEvent.screenX - startX)
      );
      this.#host.style.width = `${width}px`;
    };

    const onEnd = () => {
      resizer.removeEventListener("pointermove", onMove);
      resizer.removeEventListener("pointerup", onEnd);
      resizer.removeEventListener("lostpointercapture", onEnd);

      if (this.#activeEntry) {
        this.#savePanel(this.#activeEntry, { width });
      }
    };

    resizer.addEventListener("pointermove", onMove);
    resizer.addEventListener("pointerup", onEnd);
    resizer.addEventListener("lostpointercapture", onEnd);
  }
}

window.gZenWebPanels = new nsZenWebPanels();
