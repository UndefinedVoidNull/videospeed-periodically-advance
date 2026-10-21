import { vi } from 'vitest';
import { createMockVideo } from '../../helpers/test-utils.js';

describe('Periodic advance toggles and standalone mouse shortcuts', () => {
  let manager;
  let config;
  let handler;
  let media;
  const toggle = { action: 'toggleAdvance', code: 'KeyT', value: 3, interval: 0.5 };
  const cancel = { action: 'cancelAdvance', code: 'KeyC', value: 0 };

  function key(type, code = 'KeyT', overrides = {}) {
    document.body.dispatchEvent(
      new KeyboardEvent(type, {
        code,
        key: code.slice(-1).toLowerCase(),
        bubbles: true,
        cancelable: true,
        ...overrides,
      })
    );
  }

  function mouse(type, button = 3, overrides = {}, target = document.body) {
    const event = new MouseEvent(type, { button, bubbles: true, cancelable: true, ...overrides });
    target.dispatchEvent(event);
    return event;
  }

  function wheel(deltaY, deltaX = 0, overrides = {}) {
    const event = new WheelEvent('wheel', {
      deltaY,
      deltaX,
      bubbles: true,
      cancelable: true,
      ...overrides,
    });
    document.body.dispatchEvent(event);
    return event;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    media = [createMockVideo()];
    vi.spyOn(window.VSC.stateManager, 'getControlledElements').mockImplementation(() => media);
    config = { settings: { keyBindings: [{ ...toggle }, { ...cancel }], exclusiveKeys: false } };
    handler = { runAction: vi.fn() };
    manager = new window.VSC.EventManager(config, handler);
    manager.setupKeyboardShortcuts(document);
  });

  afterEach(() => {
    manager.cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('starts on press, survives release, and stops on the second press', () => {
    key('keydown');
    key('keyup');
    vi.advanceTimersByTime(1000);
    expect(handler.runAction.mock.calls).toEqual([
      ['advance', 3, undefined, { playingOnly: true }],
      ['advance', 3, undefined, { playingOnly: true }],
    ]);
    key('keydown');
    key('keyup');
    vi.advanceTimersByTime(2000);
    expect(handler.runAction).toHaveBeenCalledTimes(2);
    expect(manager.periodicAdvance).toBeNull();
  });

  it('ignores auto-repeat without creating more than one timer', () => {
    key('keydown');
    for (let index = 0; index < 5; index++) {
      key('keydown', 'KeyT', { repeat: true });
    }
    vi.advanceTimersByTime(500);
    expect(handler.runAction).toHaveBeenCalledTimes(1);
    expect(manager.periodicAdvance).not.toBeNull();
  });

  it('a dedicated cancel stops toggled advance without changing held speed', () => {
    config.settings.keyBindings.push({ action: 'holdSpeed', code: 'KeyH', value: 6 });
    key('keydown', 'KeyH');
    key('keydown');
    key('keyup');
    key('keydown', 'KeyC');
    key('keyup', 'KeyC');
    vi.advanceTimersByTime(1000);
    expect(handler.runAction.mock.calls).toEqual([['SET_SPEED', 6]]);
    expect(manager.heldActions.has('KeyH')).toBe(true);
  });

  it('cancel stops a held advance and auto-repeat cannot restart it', () => {
    config.settings.keyBindings.push({
      action: 'holdAdvance',
      code: 'KeyH',
      value: 4,
      interval: 0.25,
    });
    key('keydown', 'KeyH');
    vi.advanceTimersByTime(250);
    key('keydown', 'KeyC');
    key('keydown', 'KeyH', { repeat: true });
    vi.advanceTimersByTime(1000);
    expect(handler.runAction.mock.calls).toEqual([
      ['advance', 4, undefined, { playingOnly: true }],
    ]);
    expect(manager.heldActions.has('KeyH')).toBe(false);
  });

  it('starting a hold replaces the toggled timer without double seeking', () => {
    config.settings.keyBindings.push({
      action: 'holdAdvance',
      code: 'KeyH',
      value: 4,
      interval: 0.25,
    });
    key('keydown');
    key('keyup');
    key('keydown', 'KeyH');
    vi.advanceTimersByTime(500);
    expect(handler.runAction.mock.calls).toEqual([
      ['advance', 4, undefined, { playingOnly: true }],
      ['advance', 4, undefined, { playingOnly: true }],
    ]);
    expect(manager.periodicAdvance).toBeNull();
  });

  it('toggle remains on across blur; pagehide and cleanup retire its timer', () => {
    key('keydown');
    key('keyup');
    window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(500);
    expect(handler.runAction).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('pagehide'));
    vi.advanceTimersByTime(1000);
    expect(handler.runAction).toHaveBeenCalledTimes(1);
    key('keydown');
    manager.cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops when no controlled media remains', () => {
    key('keydown');
    media = [];
    vi.advanceTimersByTime(1000);
    expect(manager.periodicAdvance).toBeNull();
    expect(handler.runAction).not.toHaveBeenCalled();
  });

  it.each([0, -0.5, NaN, Infinity])('rejects an invalid interval: %s', (interval) => {
    config.settings.keyBindings[0].interval = interval;
    key('keydown');
    expect(manager.periodicAdvance).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    [1, 'MouseMiddle'],
    [3, 'MouseBack'],
    [4, 'MouseForward'],
  ])('supports a standalone mouse hold on button %s', (button, code) => {
    config.settings.keyBindings = [{ action: 'holdAdvance', code, value: 2, interval: 0.25 }];
    expect(mouse('mousedown', button).defaultPrevented).toBe(true);
    vi.advanceTimersByTime(500);
    expect(mouse('mouseup', button).defaultPrevented).toBe(true);
    expect(mouse('auxclick', button).defaultPrevented).toBe(true);
    vi.advanceTimersByTime(500);
    expect(handler.runAction.mock.calls).toEqual([
      ['advance', 2, undefined, { playingOnly: true }],
      ['advance', 2, undefined, { playingOnly: true }],
    ]);
  });

  it('side-button toggle runs once per press and auxclick never toggles it again', () => {
    config.settings.keyBindings[0].code = 'MouseBack';
    mouse('mousedown');
    mouse('mouseup');
    mouse('auxclick');
    vi.advanceTimersByTime(500);
    expect(handler.runAction).toHaveBeenCalledTimes(1);
    mouse('mousedown');
    mouse('mouseup');
    vi.advanceTimersByTime(1000);
    expect(handler.runAction).toHaveBeenCalledTimes(1);
  });

  it('unbound side buttons and cleared keyboard bindings retain native defaults', () => {
    config.settings.keyBindings = [
      { action: 'advance', code: null, key: null, keyCode: null, value: 10 },
    ];
    expect(mouse('mousedown').defaultPrevented).toBe(false);
    expect(mouse('mouseup').defaultPrevented).toBe(false);
    expect(mouse('auxclick').defaultPrevented).toBe(false);
    expect(handler.runAction).not.toHaveBeenCalled();
  });

  it('does not consume mouse actions inside text fields', () => {
    config.settings.keyBindings[0].code = 'MouseBack';
    const input = document.createElement('input');
    document.body.append(input);
    expect(mouse('mousedown', 3, {}, input).defaultPrevented).toBe(false);
    expect(manager.periodicAdvance).toBeNull();
  });

  it('installs no wheel listener until a wheel binding exists, and removes it when deleted', () => {
    expect(manager.wheelTargets.get(window).active).toBe(false);
    config.settings.keyBindings.push({ action: 'advance', code: 'WheelUp', value: 3 });
    manager.refreshWheelListeners();
    expect(manager.wheelTargets.get(window).active).toBe(true);
    expect(wheel(-100).defaultPrevented).toBe(true);
    config.settings.keyBindings = [];
    manager.refreshWheelListeners();
    expect(manager.wheelTargets.get(window).active).toBe(false);
    expect(wheel(-100).defaultPrevented).toBe(false);
  });

  it.each([
    [-100, 0, 'WheelUp'],
    [100, 0, 'WheelDown'],
    [0, -100, 'WheelLeft'],
    [0, 100, 'WheelRight'],
  ])('matches wheel deltas %s / %s as %s', (deltaY, deltaX, code) => {
    config.settings.keyBindings = [{ action: 'advance', code, value: 3 }];
    manager.refreshWheelListeners();
    expect(wheel(deltaY, deltaX).defaultPrevented).toBe(true);
    expect(handler.runAction).toHaveBeenCalledWith('advance', 3, expect.any(WheelEvent));
  });

  it('groups a continuous wheel burst into one toggle and allows the next burst to stop it', () => {
    config.settings.keyBindings[0].code = 'WheelUp';
    manager.refreshWheelListeners();
    wheel(-100);
    vi.advanceTimersByTime(100);
    wheel(-20);
    vi.advanceTimersByTime(100);
    wheel(-10);
    vi.advanceTimersByTime(300);
    expect(handler.runAction).toHaveBeenCalledTimes(1);
    wheel(-100);
    vi.advanceTimersByTime(1000);
    expect(handler.runAction).toHaveBeenCalledTimes(1);
  });

  it('preserves Ctrl+wheel zoom and refuses a wheel direction as a hold', () => {
    config.settings.keyBindings = [{ action: 'holdSpeed', code: 'WheelUp', value: 6 }];
    manager.refreshWheelListeners();
    expect(wheel(-100, 0, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(wheel(-100).defaultPrevented).toBe(false);
    expect(handler.runAction).not.toHaveBeenCalled();
  });

  it('stops active timers and refreshes wheel registration after a live binding update', () => {
    key('keydown');
    config.settings.keyBindings = [{ action: 'cancelAdvance', code: 'WheelDown', value: 0 }];
    document.documentElement.dispatchEvent(
      new CustomEvent('VSC_STORAGE_CHANGED', {
        detail: { keyBindings: { newValue: config.settings.keyBindings } },
      })
    );
    vi.advanceTimersByTime(1000);
    expect(manager.periodicAdvance).toBeNull();
    expect(manager.wheelTargets.get(window).active).toBe(true);
    expect(handler.runAction).not.toHaveBeenCalled();
  });
});
