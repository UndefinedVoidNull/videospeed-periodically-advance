import { vi } from 'vitest';
import { createMockVideo } from '../helpers/test-utils.js';
import {
  installChromeMock,
  cleanupChromeMock,
  simulateExternalStorageWrite,
} from '../helpers/chrome-mock.js';

describe('Periodic advance status beside the speed badge', () => {
  let config;
  let manager;
  let handler;
  let container;
  let video;
  let controller;

  const key = (type, code = 'Backquote') => {
    const event = new KeyboardEvent(type, { code, key: code, bubbles: true });
    Object.defineProperty(event, 'target', { value: document.body });
    if (type === 'keydown') {
      manager.handleKeydown(event);
    } else {
      manager.handleKeyup(event);
    }
  };
  const button = () => controller.div.shadowRoot.querySelector('#periodic-advance-status');

  function attachVideo() {
    const media = createMockVideo({ paused: true });
    container.append(media);
    const instance = new window.VSC.VideoController(media, container, config, handler);
    return { media, instance };
  }

  beforeEach(async () => {
    installChromeMock();
    window.VSC.stateManager.controllers.clear();
    config = new window.VSC.VideoSpeedConfig();
    await config.load();
    vi.useFakeTimers();
    window.VSC.siteHandlerManager.initialize(document);
    manager = new window.VSC.EventManager(config, null);
    handler = new window.VSC.ActionHandler(config, manager);
    manager.actionHandler = handler;
    vi.spyOn(handler, 'seek').mockImplementation(() => {});
    container = document.createElement('div');
    document.body.append(container);
    ({ media: video, instance: controller } = attachVideo());
    manager.setupKeyboardShortcuts(document);
  });

  afterEach(() => {
    manager.cleanup();
    for (const media of window.VSC.stateManager.getControlledElements()) {
      media.vsc.remove();
    }
    container.remove();
    window.VSC.stateManager.controllers.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
    cleanupChromeMock();
  });

  it('keeps A separate from the speed text and leaves always-show off by default', () => {
    expect(button().textContent).toBe('A');
    expect(button().previousElementSibling).toBe(controller.speedIndicator);
    expect(controller.speedIndicator.textContent).toBe('1.00');
    expect(button().hasAttribute('data-always-show')).toBe(false);
    expect(button().getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps the hover policy when toggled while paused, and clicking A cancels without changing speed', () => {
    expect(button().hasAttribute('data-always-show')).toBe(false);
    key('keydown');
    key('keyup');
    expect(button().hasAttribute('data-always-show')).toBe(false);
    expect(button().getAttribute('aria-pressed')).toBe('true');
    vi.advanceTimersByTime(1800);
    expect(handler.seek).not.toHaveBeenCalled();
    expect(button().hasAttribute('data-always-show')).toBe(false);
    button().click();
    expect(manager.isPeriodicAdvanceActive()).toBe(false);
    expect(button().hasAttribute('data-always-show')).toBe(false);
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(video.playbackRate).toBe(1);
    expect(video.paused).toBe(true);
  });

  it('updates held status without enabling always-show on press, release, blur and cancel', () => {
    config.settings.keyBindings = [
      { action: 'holdAdvance', code: 'KeyH', value: 4, interval: 0.25 },
      { action: 'cancelAdvance', code: 'KeyC', value: 0 },
    ];
    for (const end of ['keyup', 'blur', 'cancel']) {
      key('keydown', 'KeyH');
      expect(button().hasAttribute('data-always-show')).toBe(false);
      expect(button().getAttribute('aria-pressed')).toBe('true');
      if (end === 'keyup') {
        key('keyup', 'KeyH');
      } else if (end === 'blur') {
        window.dispatchEvent(new Event('blur'));
      } else {
        key('keydown', 'KeyC');
      }
      expect(button().hasAttribute('data-always-show')).toBe(false);
      expect(button().getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('always-show lets an inactive A start a toggle and an active A stop it', () => {
    config.settings.alwaysShowPeriodicallyAdvanceStatus = true;
    manager.updatePeriodicAdvanceStatus();
    expect(button().hasAttribute('data-always-show')).toBe(true);
    expect(button().getAttribute('aria-pressed')).toBe('false');
    button().click();
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(manager.lastPeriodicAdvanceBinding).toEqual({ value: 3, interval: 0.9 });
    button().click();
    expect(manager.periodicAdvance).toBeNull();
    expect(button().hasAttribute('data-always-show')).toBe(true);
    expect(button().getAttribute('aria-pressed')).toBe('false');
  });

  it('reuses the last shortcut parameters when restarting from A', () => {
    config.settings.alwaysShowPeriodicallyAdvanceStatus = true;
    manager.togglePeriodicAdvance({ value: 6, interval: 0.25 });
    button().click();
    button().click();
    video.play();
    vi.advanceTimersByTime(250);
    expect(handler.seek).toHaveBeenCalledWith(video, 6);
  });

  it('can start from A after all shortcuts are deleted, without adding bindings back', () => {
    config.settings.keyBindings = [];
    config.settings.alwaysShowPeriodicallyAdvanceStatus = true;
    manager.updatePeriodicAdvanceStatus();
    button().click();
    expect(manager.isPeriodicAdvanceActive()).toBe(true);
    expect(manager.lastPeriodicAdvanceBinding).toEqual({ value: 3, interval: 0.9 });
    expect(config.settings.keyBindings).toEqual([]);
  });

  it('updates every controller and initializes newly attached media with the current state', () => {
    key('keydown');
    const second = attachVideo();
    const otherButton = second.instance.div.shadowRoot.querySelector('#periodic-advance-status');
    expect(otherButton.hasAttribute('data-always-show')).toBe(false);
    expect(otherButton.getAttribute('aria-pressed')).toBe('true');
    otherButton.click();
    expect(button().hasAttribute('data-always-show')).toBe(false);
    expect(otherButton.hasAttribute('data-always-show')).toBe(false);
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(otherButton.getAttribute('aria-pressed')).toBe('false');
  });

  it('applies live preference changes without stopping an unchanged periodic binding', () => {
    key('keydown');
    const reorderedBindings = config.settings.keyBindings.map((binding) => ({
      interval: binding.interval,
      ...binding,
      predefined: false,
    }));
    simulateExternalStorageWrite({
      keyBindings: reorderedBindings,
      alwaysShowPeriodicallyAdvanceStatus: true,
    });
    expect(manager.isPeriodicAdvanceActive()).toBe(true);
    expect(button().getAttribute('aria-pressed')).toBe('true');
    button().click();
    expect(button().hasAttribute('data-always-show')).toBe(true);
    expect(button().getAttribute('aria-pressed')).toBe('false');
    simulateExternalStorageWrite({ alwaysShowPeriodicallyAdvanceStatus: false });
    expect(button().hasAttribute('data-always-show')).toBe(false);
  });

  it('clears active status on pagehide and cleanup', () => {
    key('keydown');
    window.dispatchEvent(new Event('pagehide'));
    expect(button().hasAttribute('data-always-show')).toBe(false);
    expect(button().getAttribute('aria-pressed')).toBe('false');
    key('keydown');
    manager.cleanup();
    expect(button().hasAttribute('data-always-show')).toBe(false);
    expect(button().getAttribute('aria-pressed')).toBe('false');
  });
});
