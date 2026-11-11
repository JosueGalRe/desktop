// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

const PANELS_PREF = "zen.web-panels.panels";
const MAX_ID_LENGTH = 64;
const MAX_TITLE_LENGTH = 200;
const MAX_MINUTES = 24 * 60;

const isBoolean = value => typeof value === "boolean";
const isMinutes = value =>
  Number.isInteger(value) && value >= 0 && value <= MAX_MINUTES;

// Per-panel options: the value a panel gets when it doesn't set one, and the
// check a stored value must pass. 0 means "off" for widths and minutes.
const PANEL_OPTIONS = {
  userContextId: {
    default: 0,
    isValid: value => Number.isInteger(value) && value >= 0,
  },
  title: {
    default: "",
    isValid: value =>
      typeof value === "string" && value.length <= MAX_TITLE_LENGTH,
  },
  // Emoji from Zen's picker, rendered as an SVG data URL, or a Zen icon.
  icon: {
    default: "",
    isValid: value =>
      value === "" ||
      (typeof value === "string" &&
        (value.startsWith("data:image/svg+xml;base64,") ||
          value.startsWith("chrome://browser/skin/zen-icons/"))),
  },
  mobile: { default: false, isValid: isBoolean },
  floating: { default: false, isValid: isBoolean },
  zoom: {
    default: 1,
    isValid: value => typeof value === "number" && value >= 0.3 && value <= 5,
  },
  width: {
    default: 0,
    isValid: value => Number.isInteger(value) && value >= 0 && value <= 10000,
  },
  restoreLastPage: { default: false, isValid: isBoolean },
  lastURL: {
    default: "",
    isValid: value => value === "" || ZenWebPanelsStore.isAllowedURL(value),
  },
  loadOnStartup: { default: false, isValid: isBoolean },
  unloadAfter: { default: 0, isValid: isMinutes },
  hideBadge: { default: false, isValid: isBoolean },
  hideHeader: { default: false, isValid: isBoolean },
  reloadOnTabChange: { default: false, isValid: isBoolean },
  reloadEvery: { default: 0, isValid: isMinutes },
};

/**
 * Reads and writes the configured web panels. The list lives in a pref that
 * anything with access to the profile can edit, so every entry is validated
 * before a window turns it into a browser.
 */
export const ZenWebPanelsStore = {
  PANELS_PREF,

  /**
   * Only http(s) pages may live in a panel: any other scheme could put
   * privileged or local content next to the browser chrome.
   *
   * @param {string} url
   * @returns {boolean}
   */
  isAllowedURL(url) {
    if (typeof url !== "string") {
      return false;
    }

    try {
      const uri = Services.io.newURI(url);

      return uri.schemeIs("https") || uri.schemeIs("http");
    } catch {
      return false;
    }
  },

  /**
   * Turns what the user typed into a panel URL, or null if it isn't allowed.
   *
   * @param {string} input
   * @returns {string|null}
   */
  normalizeURL(input) {
    if (typeof input !== "string" || !input.trim()) {
      return null;
    }

    const text = input.trim();
    let uri;

    try {
      uri = Services.uriFixup.getFixupURIInfo(
        // Fixup falls back to http for "example.com"; panels default to https.
        text.includes("://") ? text : `https://${text}`,
        Ci.nsIURIFixup.FIXUP_FLAG_FIX_SCHEME_TYPOS
      ).preferredURI;
    } catch {
      return null;
    }

    return uri && this.isAllowedURL(uri.spec) ? uri.spec : null;
  },

  /**
   * @returns {object[]} Every valid panel, with all of PANEL_OPTIONS set.
   */
  getPanels() {
    let stored;

    try {
      stored = JSON.parse(Services.prefs.getStringPref(PANELS_PREF, "[]"));
    } catch {
      console.warn(
        `[ZenWebPanels]: ${PANELS_PREF} isn't valid JSON, ignoring it.`
      );

      return [];
    }

    if (!Array.isArray(stored)) {
      console.warn(`[ZenWebPanels]: ${PANELS_PREF} isn't a list, ignoring it.`);

      return [];
    }

    const ids = new Set();
    const panels = [];

    for (const entry of stored) {
      if (!isValidPanel(entry) || ids.has(entry.id)) {
        console.warn(
          "[ZenWebPanels]: Invalid or duplicated web panel entry, skipping."
        );
        continue;
      }

      ids.add(entry.id);
      panels.push(withDefaults(entry));
    }

    return panels;
  },

  /**
   * @param {string} id
   * @returns {object|null}
   */
  getPanel(id) {
    return this.getPanels().find(panel => panel.id === id) ?? null;
  },

  /**
   * @param {string} input - What the user typed; it goes through URL fixup.
   * @param {object} [options] - Any of PANEL_OPTIONS.
   * @returns {object|null} The new panel, or null if the URL isn't allowed.
   */
  addPanel(input, options = {}) {
    const panel = this.createPanel(input, options);

    if (panel) {
      savePanels([...this.getPanels(), panel]);
    }

    return panel;
  },

  /**
   * A validated panel that isn't stored, like the temporary ones.
   *
   * @param {string} input - What the user typed; it goes through URL fixup.
   * @param {object} [options] - Any of PANEL_OPTIONS.
   * @returns {object|null} The panel, or null if the URL isn't allowed.
   */
  createPanel(input, options = {}) {
    const panel = {
      ...options,
      id: Services.uuid.generateUUID().toString().slice(1, -1),
      url: this.normalizeURL(input),
    };

    return isValidPanel(panel) ? withDefaults(panel) : null;
  },

  /**
   * @returns {object} Every option in PANEL_OPTIONS, at its default.
   */
  defaultOptions() {
    return Object.fromEntries(
      Object.entries(PANEL_OPTIONS).map(([optionName, option]) => [
        optionName,
        option.default,
      ])
    );
  },

  /**
   * @param {string} id
   * @param {object} changes - The url or any of PANEL_OPTIONS.
   * @returns {boolean} Whether the panel was updated.
   */
  updatePanel(id, changes) {
    const panels = this.getPanels();
    const current = panels.find(panel => panel.id === id);

    if (!current) {
      return false;
    }

    const next = { ...current, ...changes, id };

    if (Object.hasOwn(changes, "url")) {
      next.url = this.normalizeURL(changes.url);
    }

    if (!isValidPanel(next)) {
      return false;
    }

    savePanels(panels.map(panel => (panel.id === id ? next : panel)));

    return true;
  },

  /**
   * @param {string} id
   */
  removePanel(id) {
    savePanels(this.getPanels().filter(panel => panel.id !== id));
  },

  /**
   * @param {string[]} ids - Panel ids in their new order. Panels missing
   *   from the list keep their relative order at the end.
   */
  reorderPanels(ids) {
    const position = id => {
      const index = ids.indexOf(id);

      return index === -1 ? ids.length : index;
    };

    savePanels(
      this.getPanels().toSorted(
        (first, second) => position(first.id) - position(second.id)
      )
    );
  },
};

function isValidPanel(entry) {
  return (
    Boolean(entry) &&
    typeof entry === "object" &&
    typeof entry.id === "string" &&
    Boolean(entry.id.length) &&
    entry.id.length <= MAX_ID_LENGTH &&
    ZenWebPanelsStore.isAllowedURL(entry.url) &&
    Object.entries(PANEL_OPTIONS).every(
      ([optionName, option]) =>
        entry[optionName] === undefined || option.isValid(entry[optionName])
    )
  );
}

function withDefaults(entry) {
  const panel = { id: entry.id, url: entry.url };

  for (const [optionName, option] of Object.entries(PANEL_OPTIONS)) {
    panel[optionName] = entry[optionName] ?? option.default;
  }

  return panel;
}

function savePanels(panels) {
  Services.prefs.setStringPref(PANELS_PREF, JSON.stringify(panels));
}
