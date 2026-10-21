/**
 * Event management system for Video Speed Controller
 */

import {
  getMouseInputCode,
  isWheelInput,
  HOLD_ACTIONS,
  MOUSE_INPUT_LABELS,
} from './shortcut-inputs.js';

window.VSC = window.VSC || {};

class EventManager {
  constructor(config, actionHandler) {
    this.config = config;
    this.actionHandler = actionHandler;
    this.listeners = new Map();
    this.keyboardSubscriptions = [];
    this.heldActions = new Map();
    this.blockedNumberKeys = new Set();
    this.consumedKeys = new Set();
    this.pressedMouseButtons = new Set();
    this.wheelTargets = new Map();
    this.wheelToggleTimers = new Map();
    this.periodicAdvance = null;
    this.lastPeriodicAdvanceBinding = null;
    this.shortcutBindingsSignature = this.getShortcutBindingsSignature(config.settings.keyBindings);

    // Event deduplication to prevent duplicate key processing
    this.processedKeyEvents = new WeakSet();

    // Decision core: classifier (gesture evidence -> verdicts) + arbiter
    // (pure transition table). See docs/speed-arbitration.md. This module
    // is an adapter: it owns DOM listeners and consumes the write-token
    // echo filter; all accept/enforce/ignore decisions live in the
    // arbiter, and fight/gesture/echo state lives on the arbitration
    // adapter.
    this.arbitration = new window.VSC.SpeedArbitration(config, this);
  }

  /**
   * Set up all event listeners
   * @param {Document} document - Document to attach events to
   */
  setupEventListeners(document) {
    this.setupKeyboardShortcuts(document);
    this.setupRateChangeListener(document);
    this.setupUserGestureListener(document);
  }

  /**
   * Set up keyboard shortcuts
   * @param {Document} document - Document to attach events to
   */
  setupKeyboardShortcuts(document) {
    const docs = [document];

    try {
      if (window.VSC.inIframe()) {
        docs.push(window.top.document);
      }
    } catch {
      // Cross-origin iframe - ignore
    }

    docs.forEach((doc) => {
      const keydownHandler = (event) => this.handleKeydown(event);
      const keyupHandler = (event) => this.handleKeyup(event);
      const mouseHandler = (event) => this.handleMouseShortcut(event);
      const view = doc.defaultView;
      const dispatcher = view?.VSC?.keyboardDispatcher;
      if (dispatcher) {
        this.keyboardSubscriptions.push(
          dispatcher.subscribe((event) => {
            if (event.type === 'keydown') {
              keydownHandler(event);
            } else if (event.type === 'keyup') {
              keyupHandler(event);
            } else {
              mouseHandler(event);
            }
          })
        );
      } else {
        // Fallback for standalone construction and older injected bundles.
        const target = view || doc;
        target.addEventListener('keydown', keydownHandler, true);
        target.addEventListener('keyup', keyupHandler, true);
        for (const type of ['mousedown', 'mouseup', 'auxclick']) {
          target.addEventListener(type, mouseHandler, true);
        }
        if (!this.listeners.has(target)) {
          this.listeners.set(target, []);
        }
        this.listeners
          .get(target)
          .push(
            { type: 'keydown', handler: keydownHandler, useCapture: true },
            { type: 'keyup', handler: keyupHandler, useCapture: true }
          );
        for (const type of ['mousedown', 'mouseup', 'auxclick']) {
          this.listeners.get(target).push({ type, handler: mouseHandler, useCapture: true });
        }
      }

      // Opt in only when a wheel binding exists. An unconditional modern wheel
      // listener would suppress Chromium's legacy mousewheel dispatch (#1598).
      if (view && !this.wheelTargets.has(view)) {
        this.wheelTargets.set(view, { handler: mouseHandler, active: false });
      }

      const clearHolds = () => this.clearHeldActions();
      const visibilityHandler = () => {
        if (doc.hidden) {
          clearHolds();
        }
      };
      const focusHandler = (event) => {
        if (this.isTypingContext(event.composedPath?.()[0] || event.target)) {
          clearHolds();
        }
      };
      doc.addEventListener('visibilitychange', visibilityHandler, true);
      doc.addEventListener('focusin', focusHandler, true);
      if (!this.listeners.has(doc)) {
        this.listeners.set(doc, []);
      }
      this.listeners
        .get(doc)
        .push(
          { type: 'visibilitychange', handler: visibilityHandler, useCapture: true },
          { type: 'focusin', handler: focusHandler, useCapture: true }
        );
      if (view) {
        view.addEventListener('blur', clearHolds);
        const pagehideHandler = () => {
          clearHolds();
          this.cancelPeriodicAdvance();
        };
        view.addEventListener('pagehide', pagehideHandler);
        if (!this.listeners.has(view)) {
          this.listeners.set(view, []);
        }
        this.listeners
          .get(view)
          .push(
            { type: 'blur', handler: clearHolds, useCapture: false },
            { type: 'pagehide', handler: pagehideHandler, useCapture: false }
          );
      }
    });
    this.refreshWheelListeners();
    const settingsHandler = (event) => {
      if (event.detail?.keyBindings) {
        const signature = this.getShortcutBindingsSignature(event.detail.keyBindings.newValue);
        if (signature !== this.shortcutBindingsSignature) {
          this.shortcutBindingsSignature = signature;
          this.clearHeldActions();
          this.cancelPeriodicAdvance();
          this.lastPeriodicAdvanceBinding = null;
        }
        this.refreshWheelListeners();
      }
      if (event.detail?.alwaysShowPeriodicallyAdvanceStatus) {
        this.updatePeriodicAdvanceStatus();
      }
    };
    const root = document.documentElement;
    root.addEventListener('VSC_STORAGE_CHANGED', settingsHandler);
    if (!this.listeners.has(root)) {
      this.listeners.set(root, []);
    }
    this.listeners
      .get(root)
      .push({ type: 'VSC_STORAGE_CHANGED', handler: settingsHandler, useCapture: false });
  }

  refreshWheelListeners() {
    const enabled = this.config.settings.keyBindings.some((binding) => isWheelInput(binding.code));
    this.wheelTargets.forEach((entry, target) => {
      if (enabled && !entry.active) {
        target.addEventListener('wheel', entry.handler, { capture: true, passive: false });
      } else if (!enabled && entry.active) {
        target.removeEventListener('wheel', entry.handler, true);
      }
      entry.active = enabled;
    });
  }

  getShortcutBindingsSignature(bindings) {
    return JSON.stringify(
      (bindings || []).map((binding) => [
        binding.action,
        binding.code,
        binding.keyCode ?? binding.key,
        binding.value,
        binding.interval,
        ...['ctrl', 'alt', 'shift', 'meta'].map((modifier) => !!binding.modifiers?.[modifier]),
      ])
    );
  }

  isPeriodicAdvanceActive() {
    return (
      !!this.periodicAdvance ||
      [...this.heldActions.values()].some((held) => held.action === 'holdAdvance')
    );
  }

  updatePeriodicAdvanceStatus() {
    for (const media of window.VSC.stateManager?.getControlledElements() || []) {
      media.vsc?.updatePeriodicAdvanceStatus?.();
    }
  }

  getPeriodicAdvanceBinding() {
    const valid = (binding) =>
      binding &&
      Number.isFinite(binding.value) &&
      binding.value > 0 &&
      Number.isFinite(binding.interval) &&
      binding.interval > 0;
    return (
      this.lastPeriodicAdvanceBinding ||
      this.config.settings.keyBindings.find(
        (binding) => binding.action === 'toggleAdvance' && valid(binding)
      ) ||
      this.config.settings.keyBindings.find(
        (binding) => binding.action === 'holdAdvance' && valid(binding)
      ) ||
      window.VSC.Constants.DEFAULT_PERIODIC_ADVANCE
    );
  }

  /**
   * Handle keydown events
   * @param {KeyboardEvent} event - Keyboard event
   * @private
   */
  handleKeydown(event) {
    window.VSC.logger.verbose(
      `Processing keydown event: code=${event.code}, key=${event.key}, keyCode=${event.keyCode}`
    );

    // IME composition and dead key guard
    // 'Process' / keyCode 229 = IME composition active (CJK input)
    // 'Dead' = first keypress of a dead key sequence (e.g. ^ on French keyboard)
    if (
      event.isComposing ||
      event.keyCode === 229 ||
      event.key === 'Process' ||
      event.key === 'Dead'
    ) {
      return;
    }

    // Deduplicate the event itself. Distinct repeat events can share a rounded
    // timestamp and must still be suppressed before reaching the site player.
    if (this.processedKeyEvents.has(event)) {
      return;
    }
    this.processedKeyEvents.add(event);

    // Presence evidence regardless of what the key does (quiet axis).
    this.arbitration.classifier.observeInput(event);

    // Ignore keydown event if typing in an input box
    if (this.isTypingContext(event.composedPath?.()[0] || event.target)) {
      return false;
    }

    // Ignore keydown event if no media elements are present
    const mediaElements = window.VSC.stateManager
      ? window.VSC.stateManager.getControlledElements()
      : [];
    if (!mediaElements.length) {
      return false;
    }

    // Suppress all plain number keys, even those without a VSC binding. Listen
    // at window capture and stop same-target listeners as well as later phases.
    // code/keyCode cover numpad keys and keyboards reporting an empty key.
    const keyId = this.getKeyIdentity(event);
    if (this.isPlainNumberKey(event)) {
      this.blockedNumberKeys.add(keyId);
      this.suppressKey(event);
    }

    // Auto-repeat must not create extra intervals or toggle a held speed.
    if (this.heldActions.has(keyId)) {
      this.suppressKey(event);
      return false;
    }

    // Find matching key binding using the three-tier algorithm
    const keyBinding = this.findMatchingBinding(event);

    if (keyBinding) {
      if (
        HOLD_ACTIONS.includes(keyBinding.action) ||
        ['toggleAdvance', 'cancelAdvance'].includes(keyBinding.action) ||
        this.config.settings.exclusiveKeys
      ) {
        this.consumedKeys.add(keyId);
        this.suppressKey(event);
      }
      this.activateShortcut(keyBinding, keyId, event);
    } else {
      // Unhandled key — possibly a native site shortcut. Whether it counts
      // as gesture evidence is the classifier's ruling (native speed
      // shortcuts and site signatures only, per PR #1563).
      this.arbitration.classifier.observeUnhandledKey(event);
      window.VSC.logger.verbose(
        `No key binding found for code=${event.code}, keyCode=${event.keyCode}`
      );
    }

    return false;
  }

  /**
   * Stop extension holds and retire native site hold evidence on release.
   * @param {KeyboardEvent} event
   * @private
   */
  handleKeyup(event) {
    const keyId = this.getKeyIdentity(event);
    if (this.consumedKeys.delete(keyId)) {
      this.suppressKey(event);
    }
    if (this.blockedNumberKeys.delete(keyId)) {
      this.suppressKey(event);
    }
    if (this.heldActions.has(keyId)) {
      this.suppressKey(event);
      this.stopHeldAction(keyId);
    }
    const media = this.arbitration.classifier.observeKeyEnd(event);
    if (media) {
      this.arbitration.noteTemporaryOverrideEnd(media);
    }
  }

  activateShortcut(binding, keyId, event) {
    if (HOLD_ACTIONS.includes(binding.action)) {
      if (!event.repeat && !isWheelInput(keyId)) {
        this.startHeldAction(keyId, binding);
      }
    } else if (binding.action === 'toggleAdvance') {
      if (!event.repeat) {
        this.togglePeriodicAdvance(binding);
      }
    } else if (binding.action === 'cancelAdvance') {
      this.cancelPeriodicAdvance();
    } else {
      this.actionHandler.runAction(binding.action, binding.value, event);
    }
  }

  handleMouseShortcut(event) {
    const code = getMouseInputCode(event);
    if (!code) {
      return;
    }
    if (event.type === 'mouseup') {
      const consumed = this.pressedMouseButtons.delete(code);
      if (this.heldActions.has(code)) {
        this.stopHeldAction(code);
        this.suppressKey(event);
      } else if (consumed) {
        this.suppressKey(event);
      }
      return;
    }
    if (
      this.isTypingContext(event.composedPath?.()[0] || event.target) ||
      !window.VSC.stateManager?.getControlledElements().length
    ) {
      return;
    }
    const binding = this.findMatchingBinding({
      code,
      keyCode: null,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
    });
    if (!binding || (isWheelInput(code) && HOLD_ACTIONS.includes(binding.action))) {
      return;
    }
    // Bound mouse actions own their default too: side-button navigation,
    // middle-click autoscroll/new-tab, and wheel scrolling must not also fire.
    this.suppressKey(event);
    if (event.type === 'auxclick') {
      return;
    }
    if (event.type === 'mousedown') {
      if (this.pressedMouseButtons.has(code)) {
        return;
      }
      this.pressedMouseButtons.add(code);
    }
    if (event.type === 'wheel' && binding.action === 'toggleAdvance') {
      const continuingBurst = this.wheelToggleTimers.has(code);
      clearTimeout(this.wheelToggleTimers.get(code));
      this.wheelToggleTimers.set(
        code,
        setTimeout(() => this.wheelToggleTimers.delete(code), 250)
      );
      if (continuingBurst) {
        return;
      }
    }
    this.activateShortcut(binding, code, event);
  }

  createAdvanceTimer(binding, onEmpty) {
    if (
      !Number.isFinite(binding.value) ||
      binding.value <= 0 ||
      !Number.isFinite(binding.interval) ||
      binding.interval <= 0
    ) {
      return null;
    }
    return setInterval(
      () => {
        if (!window.VSC.stateManager?.getControlledElements().length) {
          onEmpty();
          return;
        }
        // Keep the mode enabled while paused, but skip that media's seek.
        // Resuming uses the next interval; paused ticks are never queued up.
        this.actionHandler.runAction('advance', binding.value, undefined, { playingOnly: true });
      },
      Math.max(1, binding.interval * 1000)
    );
  }

  togglePeriodicAdvance(binding = this.getPeriodicAdvanceBinding()) {
    if (this.isPeriodicAdvanceActive()) {
      this.cancelPeriodicAdvance();
      return;
    }
    const timer = this.createAdvanceTimer(binding, () => this.cancelPeriodicAdvance());
    if (timer !== null) {
      this.periodicAdvance = { timer };
      this.lastPeriodicAdvanceBinding = { value: binding.value, interval: binding.interval };
      this.updatePeriodicAdvanceStatus();
    }
  }

  cancelPeriodicAdvance() {
    if (this.periodicAdvance) {
      clearInterval(this.periodicAdvance.timer);
      this.periodicAdvance = null;
    }
    for (const [keyId, held] of this.heldActions) {
      if (held.action === 'holdAdvance') {
        this.stopHeldAction(keyId);
      }
    }
    this.updatePeriodicAdvanceStatus();
  }

  getKeyIdentity(event) {
    return event.code && event.code !== 'Unidentified'
      ? event.code
      : String(event.keyCode || event.key);
  }

  isPlainNumberKey(event) {
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
      return false;
    }
    return (
      /^[0-9]$/.test(event.key) ||
      /^(Digit|Numpad)[0-9]$/.test(event.code) ||
      (event.keyCode >= 48 && event.keyCode <= 57) ||
      (event.keyCode >= 96 && event.keyCode <= 105)
    );
  }

  suppressKey(event) {
    event.preventDefault();
    if (event.stopImmediatePropagation) {
      event.stopImmediatePropagation();
    } else {
      event.stopPropagation();
    }
  }

  startHeldAction(keyId, binding) {
    const { action, value, interval } = binding;
    if (!Number.isFinite(value) || value <= 0) {
      return;
    }
    if (action === 'holdAdvance' && (!Number.isFinite(interval) || interval <= 0)) {
      return;
    }
    if (action === 'holdAdvance') {
      this.cancelPeriodicAdvance();
    }
    const held = { action, value, timer: null };
    this.heldActions.set(keyId, held);
    if (action === 'holdSpeed') {
      this.actionHandler.runAction('SET_SPEED', value);
    } else {
      // First advance occurs after the configured interval, independent of
      // OS keyboard repeat delay/rate. Releasing earlier performs no seek.
      held.timer = this.createAdvanceTimer(binding, () => this.stopHeldAction(keyId));
      this.lastPeriodicAdvanceBinding = { value, interval };
      this.updatePeriodicAdvanceStatus();
    }
  }

  stopHeldAction(keyId) {
    const held = this.heldActions.get(keyId);
    if (!held) {
      return;
    }
    clearInterval(held.timer);
    this.heldActions.delete(keyId);
    if (held.action === 'holdAdvance') {
      this.updatePeriodicAdvanceStatus();
    }
    if (held.action === 'holdSpeed') {
      const remaining = [...this.heldActions.values()].filter(
        (item) => item.action === 'holdSpeed'
      );
      this.actionHandler.runAction('SET_SPEED', remaining.at(-1)?.value ?? 1.0);
    }
  }

  clearHeldActions() {
    const resetSpeed = [...this.heldActions.values()].some((item) => item.action === 'holdSpeed');
    this.heldActions.forEach((held) => clearInterval(held.timer));
    this.heldActions.clear();
    this.blockedNumberKeys.clear();
    this.consumedKeys.clear();
    this.pressedMouseButtons.clear();
    this.updatePeriodicAdvanceStatus();
    if (resetSpeed) {
      this.actionHandler.runAction('SET_SPEED', 1.0);
    }
  }

  /**
   * Three-tier binding match: chord → simple → legacy fallback.
   *
   * When event.code is empty/Unidentified (virtual keyboards, remote desktop,
   * accessibility devices), falls back to keyCode matching for all bindings.
   *
   * @param {KeyboardEvent} event
   * @returns {Object|undefined} Matching binding, or undefined
   * @private
   */
  findMatchingBinding(event) {
    const bindings = this.config.settings.keyBindings;
    const code = event.code;
    const keyCode = event.keyCode;
    const ctrl = !!event.ctrlKey;
    const alt = !!event.altKey;
    const meta = !!event.metaKey;
    const shift = !!event.shiftKey;
    const hasModifier = ctrl || alt || meta;

    // Runtime fallback: if event.code is empty or unidentified, match on keyCode
    if (!code || code === 'Unidentified') {
      return bindings.find((b) => {
        const bKey = b.keyCode ?? b.key;
        if (bKey !== keyCode) {
          return false;
        }
        return b.modifiers
          ? EventManager.modifiersMatch(b.modifiers, ctrl, alt, meta, shift)
          : !hasModifier;
      });
    }

    // Tier 1: Chord match — bindings WITH modifiers, all must match exactly
    const chordMatch = bindings.find(
      (b) =>
        b.modifiers &&
        b.code === code &&
        EventManager.modifiersMatch(b.modifiers, ctrl, alt, meta, shift)
    );
    if (chordMatch) {
      return chordMatch;
    }

    // Tier 2: Simple match — bindings WITHOUT modifiers, no Ctrl/Alt/Meta active
    if (!hasModifier) {
      const simpleMatch = bindings.find((b) => !b.modifiers && b.code === code);
      if (simpleMatch) {
        return simpleMatch;
      }
    }

    // Mouse inputs have no legacy keyboard integer. A cleared shortcut with a
    // null key must never accidentally match a mouse event's absent keyCode.
    if (MOUSE_INPUT_LABELS[code]) {
      return undefined;
    }

    // Tier 3: Legacy fallback — bindings missing code field, match on keyCode
    if (!hasModifier) {
      const legacyMatch = bindings.find((b) => {
        if (b.code !== null && b.code !== undefined) {
          return false;
        }
        return (b.keyCode ?? b.key) === keyCode;
      });
      if (legacyMatch) {
        return legacyMatch;
      }
    }

    return undefined;
  }

  /**
   * Check if user is typing in an input context
   * @param {Element} target - Event target
   * @returns {boolean} True if typing context
   * @private
   */
  isTypingContext(target) {
    const field = target?.closest?.('input, textarea, select');
    if (field?.nodeName === 'INPUT') {
      // Player sliders and buttons can retain focus without being text fields.
      return ![
        'button',
        'checkbox',
        'color',
        'file',
        'hidden',
        'image',
        'radio',
        'range',
        'reset',
        'submit',
      ].includes(field.type);
    }
    return (
      field?.nodeName === 'TEXTAREA' ||
      field?.nodeName === 'SELECT' ||
      target?.isContentEditable ||
      !!target?.closest?.('[contenteditable]:not([contenteditable="false"]), [role="textbox"]')
    );
  }

  /**
   * Feed user interactions that originate outside the VSC controller to the
   * classifier's evidence ledger. Clicks on native speed UI land here;
   * unhandled keys land in handleKeydown; pointer lifecycle events cover
   * click-and-hold interactions (evidence only under TARGET_RULES, per
   * PR #1555).
   * The classifier — not this module — decides what counts as intent.
   * @param {Document} document
   * @private
   */
  setupUserGestureListener(document) {
    const clickHandler = (event) => {
      // Skip clicks on our own controller (shadow host retargeted at boundary)
      if (event.target?.closest?.('vsc-controller')) {
        return;
      }
      this.arbitration.classifier.observeClick(event, this.resolveGestureMedia(event));
    };
    const pointerDownHandler = (event) => {
      if (event.target?.closest?.('vsc-controller')) {
        return;
      }
      this.arbitration.classifier.observePointerDown(event, this.resolveGestureMedia(event));
    };
    // Do not filter terminal events by target: a pointer that began outside
    // VSC can end on a captured/retargeted VSC node, and its hold must still
    // be retired by pointer ID. The active local override remains until its
    // following normal ratechange, which makes browser listener ordering safe.
    // `lostpointercapture` is deliberately NOT a terminal signal: capture
    // events are synthesized bookkeeping whose `buttons` value varies across
    // browser builds, and YouTube can shed capture mid-hold. Real releases
    // always reach these document-capture pointerup/pointercancel listeners.
    const pointerEndHandler = (event) => {
      for (const video of this.arbitration.classifier.observePointerEnd(event)) {
        this.arbitration.noteTemporaryOverrideEnd(video);
      }
    };
    // Browser focus/page lifecycle can swallow a physical terminal event.
    // Do not let old hold evidence become indefinite across that boundary.
    const clearTemporaryHolds = () => {
      for (const video of this.arbitration.classifier.clearTemporaryHolds()) {
        this.arbitration.noteTemporaryOverrideEnd(video);
      }
    };
    const visibilityHandler = (event) => {
      if (document.hidden) {
        clearTemporaryHolds(event);
      }
    };
    // Presence-only evidence for the quiet/activity axis: a single
    // timestamp assignment per event. Deliberately coarse — no payloads are
    // read (see classifier privacy note).
    const inputHandler = (event) => {
      this.arbitration.classifier.observeInput(event);
    };
    document.addEventListener('click', clickHandler, true);
    document.addEventListener('pointerdown', pointerDownHandler, true);
    document.addEventListener('pointerup', pointerEndHandler, true);
    document.addEventListener('pointercancel', pointerEndHandler, true);
    document.addEventListener('visibilitychange', visibilityHandler, true);
    document.addEventListener('pointermove', inputHandler, { capture: true, passive: true });
    // Do not observe `wheel` on document. In Chromium, registering the modern
    // event there suppresses the legacy `mousewheel` fallback used by page
    // controls such as Bilibili's web-fullscreen volume handler (#1598).
    document.addEventListener('touchstart', inputHandler, { capture: true, passive: true });

    if (!this.listeners.has(document)) {
      this.listeners.set(document, []);
    }
    this.listeners
      .get(document)
      .push(
        { type: 'click', handler: clickHandler, useCapture: true },
        { type: 'pointerdown', handler: pointerDownHandler, useCapture: true },
        { type: 'pointerup', handler: pointerEndHandler, useCapture: true },
        { type: 'pointercancel', handler: pointerEndHandler, useCapture: true },
        { type: 'visibilitychange', handler: visibilityHandler, useCapture: true },
        { type: 'pointermove', handler: inputHandler, useCapture: true },
        { type: 'touchstart', handler: inputHandler, useCapture: true }
      );

    const view = document.defaultView;
    if (view) {
      if (!this.listeners.has(view)) {
        this.listeners.set(view, []);
      }
      // Bubble phase is load-bearing: `blur` does not bubble but DOES capture
      // through window for every element-level focus change. A capture
      // listener here fires when a press moves page focus, wiping hold
      // evidence milliseconds after the pointerdown that armed it. Without
      // capture, only a genuine window blur (app/tab switch) reaches this.
      view.addEventListener('blur', clearTemporaryHolds);
      view.addEventListener('pagehide', clearTemporaryHolds);
      this.listeners
        .get(view)
        .push(
          { type: 'blur', handler: clearTemporaryHolds, useCapture: false },
          { type: 'pagehide', handler: clearTemporaryHolds, useCapture: false }
        );
    }
  }

  /**
   * Associate a page gesture with a controlled media element only when the
   * DOM path or current site handler identifies one unambiguous owner.
   * Unresolved gestures deliberately retain the classifier's legacy
   * document-level fallback scope.
   * @param {Event} event
   * @returns {HTMLMediaElement|null}
   */
  resolveGestureMedia(event) {
    const mediaElements = window.VSC.stateManager
      ? window.VSC.stateManager.getControlledElements()
      : [];
    if (mediaElements.length === 0) {
      return null;
    }

    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    const controlled = new Set(mediaElements);
    const directMatches = new Set(path.filter((node) => controlled.has(node)));
    if (directMatches.size === 1) {
      return directMatches.values().next().value;
    }
    if (directMatches.size > 1 || mediaElements.length === 1) {
      return null;
    }

    const resolved = window.VSC.siteHandlerManager?.resolveGestureMedia?.(event, mediaElements);
    return controlled.has(resolved) ? resolved : null;
  }

  /**
   * Set up rate change event listener
   * @param {Document} document - Document to attach events to
   */
  setupRateChangeListener(document) {
    const rateChangeHandler = (event) => this.handleRateChange(event);
    document.addEventListener('ratechange', rateChangeHandler, true);

    // Store reference for cleanup
    if (!this.listeners.has(document)) {
      this.listeners.set(document, []);
    }
    this.listeners.get(document).push({
      type: 'ratechange',
      handler: rateChangeHandler,
      useCapture: true,
    });
  }

  /**
   * Handle rate change events
   * @param {Event} event - Rate change event
   * @private
   */
  handleRateChange(event) {
    // Get the actual video element (handle shadow DOM)
    const video = event.composedPath ? event.composedPath()[0] : event.target;

    // Skip if no VSC controller attached
    if (!video.vsc) {
      window.VSC.logger.debug('Skipping ratechange - no VSC controller attached');
      return;
    }

    // Echo filter: our own write coming back through the register. A
    // consumed token identifies exactly one expected echo — unlike the
    // legacy time-based cooldown, nothing genuinely external is ever
    // masked, so reactive sites that rewrite the rate in response to our
    // writes produce budget-accounted fight exchanges instead of an
    // invisible write war.
    const echo = this.arbitration.consumeEcho(video, video.playbackRate);
    if (echo) {
      window.VSC.logger.debug('Ignoring own write echo (in-flight token consumed)');
      if (echo.suppressPropagation) {
        // A page listener already proved that observing this exact VSC write
        // causes it to rewrite the register. Hide only the guarded retry echo
        // to break that feedback loop; ordinary writes remain observable.
        event.stopImmediatePropagation();
      } else {
        // Filter the echo only from VSC's decision pipeline. A target observer
        // runs after previously registered page listeners and records only a
        // direct rewrite caused by this same event.
        this.arbitration.observePropagatedEcho(video, event, echo);
      }
      return;
    }

    const reactiveRewrite = this.arbitration.consumeEchoReaction(video, event);
    if (reactiveRewrite === null) {
      // A page synchronously dispatched another ratechange while handling the
      // VSC echo. Let the outer event reach its target-tail observer and wait
      // for the native counter-event before retrying, avoiding reentrant writes.
      event.stopImmediatePropagation();
      return;
    }

    // Belt: origin-tagged synthetic events. This extension no longer
    // dispatches them (the token filter replaced that mechanism), but a
    // stale page-world script from a previous version may still emit them
    // during an extension update; the classifier's SELF verdict mirrors
    // this guard.
    if (event.detail && event.detail.origin === 'videoSpeed') {
      window.VSC.logger.debug('Ignoring extension-originated rate change');
      return;
    }

    // Ignore external ratechanges during video initialization
    if (video.readyState < 1) {
      window.VSC.logger.debug(
        'Ignoring external ratechange during video initialization (readyState < 1)'
      );
      return;
    }

    // Ignore spurious external ratechanges below our supported MIN
    const rawExternalRate = typeof video.playbackRate === 'number' ? video.playbackRate : NaN;
    const min = window.VSC.Constants.SPEED_LIMITS.MIN;
    if (!isNaN(rawExternalRate) && rawExternalRate <= min) {
      window.VSC.logger.debug(
        `Ignoring external ratechange below MIN: raw=${rawExternalRate}, MIN=${min}`
      );
      return;
    }

    // Everything past the guards above is a genuine external change. A proven
    // echo counter-write is autonomous regardless of stale gesture evidence;
    // all other changes use the classifier. The arbiter still owns every
    // accept/enforce/ignore transition and effect.
    const verdict = reactiveRewrite
      ? window.VSC.IntentClassifier.VERDICTS.AUTONOMOUS
      : this.arbitration.classifier.classify({
          media: video,
          rate: video.playbackRate,
          timeStamp: event.timeStamp,
          readyState: video.readyState,
          detail: event.detail,
        });
    this.arbitration.onExternalRate(video, event, verdict, {
      suppressRetryEcho: reactiveRewrite,
    });
  }

  /**
   * Clean up all event listeners
   */
  cleanup() {
    this.clearHeldActions();
    this.cancelPeriodicAdvance();
    this.wheelToggleTimers.forEach((timer) => clearTimeout(timer));
    this.wheelToggleTimers.clear();
    this.wheelTargets.forEach(({ handler, active }, target) => {
      if (active) {
        target.removeEventListener('wheel', handler, true);
      }
    });
    this.wheelTargets.clear();
    this.keyboardSubscriptions.forEach((unsubscribe) => unsubscribe());
    this.keyboardSubscriptions = [];
    this.listeners.forEach((eventList, doc) => {
      eventList.forEach(({ type, handler, useCapture }) => {
        try {
          doc.removeEventListener(type, handler, useCapture);
        } catch (e) {
          window.VSC.logger.warn(`Failed to remove event listener: ${e.message}`);
        }
      });
    });

    this.listeners.clear();

    this.arbitration.cleanup();
  }
}

/**
 * Compare binding modifiers against event modifier state.
 * @returns {boolean} True if all four modifiers match exactly.
 */
EventManager.modifiersMatch = function (mods, ctrl, alt, meta, shift) {
  return mods.ctrl === ctrl && mods.alt === alt && mods.meta === meta && mods.shift === shift;
};

// Timing constants live where the state lives: gesture-window timing on
// IntentClassifier; fight-window timing, the fight budget, and the echo
// filter (write tokens) on SpeedArbitration/SpeedArbiter.

// Create singleton instance
window.VSC.EventManager = EventManager;
