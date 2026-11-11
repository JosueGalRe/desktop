// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { ZenWebPanelsStore } from "chrome://browser/content/zen-components/ZenWebPanelsStore.mjs";

const UNLOAD_AFTER_MINUTES = [0, 5, 15, 30, 60, 120];
const RELOAD_EVERY_MINUTES = [0, 1, 5, 15, 30, 60];
const DEFAULT_ICON = "chrome://global/skin/icons/defaultFavicon.svg";

// On/off options, in the order the editor lists them.
const TOGGLES = {
  mobile: "zen-web-panels-editor-mobile",
  floating: "zen-web-panels-editor-floating",
  restoreLastPage: "zen-web-panels-editor-restore-last-page",
  loadOnStartup: "zen-web-panels-editor-load-on-startup",
  hideBadge: "zen-web-panels-editor-hide-badge",
  hideHeader: "zen-web-panels-editor-hide-header",
  reloadOnTabChange: "zen-web-panels-editor-reload-on-tab-change",
};

/**
 * The popover that edits a panel. For a stored panel every change is saved
 * right away and windows pick it up through the panels pref; for a new one
 * the changes wait in a draft until Add.
 */
export class nsZenWebPanelsEditor {
  #popup = null;
  #panelId = null;
  #draft = null;
  #onAdd = null;

  /**
   * @param {object} panel - A stored panel.
   * @param {Element} anchor
   */
  open(panel, anchor) {
    this.#panelId = panel.id;
    this.#draft = null;
    this.#openAt(anchor);
  }

  /**
   * Opens the editor for a panel that doesn't exist yet.
   *
   * @param {object} options - Starting values, like the selected tab's page.
   * @param {Element} anchor
   * @param {Function} onAdd - Called with the panel once it's stored.
   */
  openNew(options, anchor, onAdd) {
    this.#panelId = null;
    this.#draft = { ...ZenWebPanelsStore.defaultOptions(), ...options };
    this.#onAdd = onAdd;
    this.#openAt(anchor);
  }

  #openAt(anchor) {
    this.#popup ??= this.#create();
    this.#fill(this.#current());

    // From the sidebar it opens toward the content; from the panel header,
    // below the button.
    let position = "after_end";

    if (anchor.closest("#zen-web-panels-sidebar")) {
      const sidebarOnRight =
        document.documentElement.getAttribute("zen-right-side") !== "true";

      position = sidebarOnRight ? "start_before" : "end_before";
    }

    this.#popup.openPopup(anchor, position);
  }

  #current() {
    return this.#draft ?? ZenWebPanelsStore.getPanel(this.#panelId);
  }

  /**
   * @param {object} changes
   * @returns {boolean} Whether the changes are valid.
   */
  #save(changes) {
    if (!this.#draft) {
      return ZenWebPanelsStore.updatePanel(this.#panelId, changes);
    }

    Object.assign(this.#draft, changes);

    return (
      !Object.hasOwn(changes, "url") ||
      ZenWebPanelsStore.isAllowedURL(
        ZenWebPanelsStore.normalizeURL(changes.url)
      )
    );
  }

  #add() {
    const popup = this.#popup;

    // Enter doesn't wait for the fields' change events.
    this.#save({
      title: popup.querySelector(".zen-web-panels-editor-title").value.trim(),
      url: popup.querySelector(".zen-web-panels-editor-url").value,
    });

    const panel = ZenWebPanelsStore.addPanel(this.#draft.url, this.#draft);

    if (!panel) {
      popup.querySelector(".zen-web-panels-editor-url-error").hidden = false;
      return;
    }

    const onAdd = this.#onAdd;

    popup.hidePopup();
    onAdd(panel);
  }

  #create() {
    const toggles = Object.entries(TOGGLES)
      .map(
        ([option, l10nId]) =>
          `<checkbox class="zen-web-panels-editor-toggle" option="${option}" data-l10n-id="${l10nId}"/>`
      )
      .join("");

    // It doesn't follow its anchor: saving re-renders the sidebar items and
    // "Hide the toolbar" hides the header button, and an arrow panel closes
    // when the node it follows goes away.
    const popup = window.MozXULElement.parseXULToFragment(`
      <panel id="zen-web-panels-editor" type="arrow" orient="vertical" followanchor="false">
        <vbox class="zen-web-panels-editor-body">
          <hbox class="zen-web-panels-editor-identity" align="center">
            <toolbarbutton class="toolbarbutton-1 zen-web-panels-editor-icon"
                           badged="true"
                           data-l10n-id="zen-web-panels-editor-icon"/>
            <html:input class="zen-web-panels-editor-title" maxlength="200" data-l10n-id="zen-web-panels-editor-title"/>
          </hbox>
          <html:input class="zen-web-panels-editor-url" type="url" data-l10n-id="zen-web-panels-editor-url"/>
          <description class="zen-web-panels-editor-url-error description-deemphasized"
                       data-l10n-id="zen-web-panels-editor-invalid-url"
                       hidden="true"/>
          <hbox class="zen-web-panels-editor-row zen-web-panels-editor-container-row" align="center">
            <label data-l10n-id="zen-web-panels-editor-container" flex="1"/>
            <menulist class="zen-web-panels-editor-container"/>
          </hbox>
          ${toggles}
          <hbox class="zen-web-panels-editor-row" align="center">
            <label data-l10n-id="zen-web-panels-editor-unload-after" flex="1"/>
            <menulist class="zen-web-panels-editor-minutes" option="unloadAfter"/>
          </hbox>
          <hbox class="zen-web-panels-editor-row" align="center">
            <label data-l10n-id="zen-web-panels-editor-reload-every" flex="1"/>
            <menulist class="zen-web-panels-editor-minutes" option="reloadEvery"/>
          </hbox>
          <hbox class="zen-web-panels-editor-footer" pack="end">
            <button class="zen-web-panels-editor-add footer-button primary"
                    default="true"
                    data-l10n-id="zen-web-panels-editor-add"/>
          </hbox>
        </vbox>
      </panel>
    `).firstElementChild;

    for (const [option, choices] of [
      ["unloadAfter", UNLOAD_AFTER_MINUTES],
      ["reloadEvery", RELOAD_EVERY_MINUTES],
    ]) {
      const menulist = popup.querySelector(`menulist[option="${option}"]`);
      const menupopup = document.createXULElement("menupopup");

      for (const minutes of choices) {
        const item = document.createXULElement("menuitem");
        item.setAttribute("value", String(minutes));
        document.l10n.setAttributes(item, "zen-web-panels-editor-minutes", {
          minutes,
        });
        menupopup.appendChild(item);
      }

      menulist.appendChild(menupopup);
    }

    const title = popup.querySelector(".zen-web-panels-editor-title");
    const url = popup.querySelector(".zen-web-panels-editor-url");
    const urlError = popup.querySelector(".zen-web-panels-editor-url-error");
    const icon = popup.querySelector(".zen-web-panels-editor-icon");

    title.addEventListener("change", () =>
      this.#save({ title: title.value.trim() })
    );
    url.addEventListener("change", () => {
      urlError.hidden = this.#save({ url: url.value });
      this.#fillIcon(this.#current());
    });

    icon.addEventListener("command", () => {
      gZenEmojiPicker.open(icon, {
        emojiAsSVG: true,
        allowNone: Boolean(this.#current()?.icon),
        onSelect: emoji => {
          this.#save({ icon: emoji ?? "" });
          this.#fillIcon(this.#current());
        },
      });
    });

    popup
      .querySelector(".zen-web-panels-editor-add")
      .addEventListener("command", () => this.#add());

    popup.addEventListener("keydown", event => {
      if (
        this.#draft &&
        event.key === "Enter" &&
        event.target.localName === "input"
      ) {
        event.preventDefault();
        this.#add();
      }
    });

    popup.addEventListener("popupshown", event => {
      if (event.target === popup && this.#draft) {
        url.focus();
        url.select();
      }
    });

    popup.addEventListener("popuphidden", event => {
      if (event.target === popup) {
        this.#draft = null;
        this.#onAdd = null;
      }
    });

    popup.addEventListener("command", event => {
      const option = event.target.closest("[option]")?.getAttribute("option");

      if (!option) {
        return;
      }

      if (option in TOGGLES) {
        this.#save({ [option]: event.target.checked });
      } else {
        this.#save({
          [option]: Number(event.target.closest("menulist").value),
        });
      }
    });

    popup
      .querySelector(".zen-web-panels-editor-container")
      .addEventListener("command", event =>
        this.#save({ userContextId: Number(event.currentTarget.value) })
      );

    document.getElementById("mainPopupSet").appendChild(popup);

    return popup;
  }

  #fill(panel) {
    const popup = this.#popup;

    this.#fillIcon(panel);
    popup.querySelector(".zen-web-panels-editor-title").value = panel.title;
    popup.querySelector(".zen-web-panels-editor-url").value = panel.url;
    popup.querySelector(".zen-web-panels-editor-url-error").hidden = true;
    popup.querySelector(".zen-web-panels-editor-footer").hidden = !this.#draft;

    for (const checkbox of popup.querySelectorAll(
      ".zen-web-panels-editor-toggle"
    )) {
      checkbox.checked = panel[checkbox.getAttribute("option")];
    }

    for (const menulist of popup.querySelectorAll(
      ".zen-web-panels-editor-minutes"
    )) {
      menulist.value = String(panel[menulist.getAttribute("option")]);
    }

    this.#fillContainers(panel);
  }

  #fillIcon(panel) {
    const pageIcon = panel?.url ? `page-icon:${panel.url}` : DEFAULT_ICON;

    this.#popup
      .querySelector(".zen-web-panels-editor-icon")
      .setAttribute("image", panel?.icon || pageIcon);
  }

  #fillContainers(panel) {
    const row = this.#popup.querySelector(
      ".zen-web-panels-editor-container-row"
    );
    const menulist = row.querySelector("menulist");
    const identities = Services.prefs.getBoolPref(
      "privacy.userContext.enabled",
      false
    )
      ? ContextualIdentityService.getPublicIdentities()
      : [];

    row.hidden = !identities.length;

    if (!identities.length) {
      return;
    }

    const menupopup = document.createXULElement("menupopup");
    const none = document.createXULElement("menuitem");

    document.l10n.setAttributes(none, "zen-web-panels-editor-no-container");
    none.setAttribute("value", "0");
    menupopup.appendChild(none);

    for (const identity of identities) {
      const item = document.createXULElement("menuitem");

      item.setAttribute(
        "label",
        ContextualIdentityService.getUserContextLabel(identity.userContextId)
      );
      item.setAttribute("value", String(identity.userContextId));
      menupopup.appendChild(item);
    }

    menulist.replaceChildren(menupopup);
    menulist.value = String(panel.userContextId);
  }
}
