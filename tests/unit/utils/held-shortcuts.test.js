import { vi } from 'vitest';
import { createMockVideo } from '../../helpers/test-utils.js';

describe('Held shortcuts and number-key interception', () => {
  let eventManager;
  let actionHandler;
  let config;
  let media;

  const dispatchKey = (type, options = {}, target = document.body) => {
    const event = new KeyboardEvent(type, {
      code: 'Backquote',
      key: '`',
      keyCode: 192,
      bubbles: true,
      composed: true,
      cancelable: true,
      ...options,
    });
    target.dispatchEvent(event);
    return event;
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    media = [createMockVideo()];
    vi.spyOn(window.VSC.stateManager, 'getControlledElements').mockImplementation(() => media);
    config = {
      settings: {
        keyBindings: [
          { action: 'holdAdvance', code: 'Backquote', key: 192, value: 3, interval: 0.5 },
        ],
        exclusiveKeys: false,
      },
    };
    actionHandler = { runAction: vi.fn() };
    eventManager = new window.VSC.EventManager(config, actionHandler);
    eventManager.setupKeyboardShortcuts(document);
  });

  afterEach(() => {
    eventManager.cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('advances on the configured clock, ignores auto-repeat, and stops on release', () => {
    expect(dispatchKey('keydown').defaultPrevented).toBe(true);
    vi.advanceTimersByTime(499);
    expect(actionHandler.runAction).not.toHaveBeenCalled();
    for (let index = 0; index < 4; index++) {
      dispatchKey('keydown', { repeat: true });
    }
    vi.advanceTimersByTime(501);
    expect(actionHandler.runAction.mock.calls).toEqual([
      ['advance', 3, undefined, { playingOnly: true }],
      ['advance', 3, undefined, { playingOnly: true }],
    ]);
    dispatchKey('keyup');
    vi.advanceTimersByTime(5000);
    expect(actionHandler.runAction).toHaveBeenCalledTimes(2);
    expect(eventManager.heldActions.size).toBe(0);
  });

  it('a tap shorter than the interval does not seek', () => {
    dispatchKey('keydown');
    vi.advanceTimersByTime(250);
    dispatchKey('keyup');
    vi.advanceTimersByTime(1000);
    expect(actionHandler.runAction).not.toHaveBeenCalled();
  });

  it('uses the configured speed while held and restores 1x even if modifiers changed', () => {
    config.settings.keyBindings = [{ action: 'holdSpeed', code: 'Backquote', value: 6 }];
    dispatchKey('keydown');
    dispatchKey('keydown', { repeat: true });
    expect(actionHandler.runAction.mock.calls).toEqual([['SET_SPEED', 6]]);
    dispatchKey('keyup', { shiftKey: true });
    expect(actionHandler.runAction.mock.calls).toEqual([
      ['SET_SPEED', 6],
      ['SET_SPEED', 1],
    ]);
  });

  it.each(['blur', 'pagehide', 'focusin', 'visibilitychange', 'cleanup'])(
    'stops pending seeks on %s',
    (type) => {
      dispatchKey('keydown');
      if (type === 'cleanup') {
        eventManager.cleanup();
      } else if (type === 'focusin') {
        const input = document.createElement('input');
        document.body.append(input);
        input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      } else if (type === 'visibilitychange') {
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        document.dispatchEvent(new Event(type));
      } else {
        window.dispatchEvent(new Event(type));
      }
      vi.advanceTimersByTime(2000);
      expect(actionHandler.runAction).not.toHaveBeenCalled();
      expect(eventManager.heldActions.size).toBe(0);
    }
  );

  it('restores speed when the window loses focus', () => {
    config.settings.keyBindings = [{ action: 'holdSpeed', code: 'Backquote', value: 6 }];
    dispatchKey('keydown');
    window.dispatchEvent(new Event('blur'));
    expect(actionHandler.runAction.mock.calls).toEqual([
      ['SET_SPEED', 6],
      ['SET_SPEED', 1],
    ]);
    dispatchKey('keyup');
    expect(actionHandler.runAction).toHaveBeenCalledTimes(2);
  });

  it('stops the interval when the last controlled media disappears', () => {
    dispatchKey('keydown');
    media = [];
    vi.advanceTimersByTime(2000);
    expect(actionHandler.runAction).not.toHaveBeenCalled();
    expect(eventManager.heldActions.size).toBe(0);
  });

  it.each([0, -1, NaN, Infinity])('rejects invalid hold intervals: %s', (interval) => {
    config.settings.keyBindings[0].interval = interval;
    dispatchKey('keydown');
    expect(eventManager.heldActions.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('blocks every digit, repeat, and keyup before page window/document listeners', () => {
    const siteHandler = vi.fn();
    window.addEventListener('keydown', siteHandler, true);
    window.addEventListener('keyup', siteHandler, true);
    document.addEventListener('keydown', siteHandler, true);
    try {
      for (let digit = 0; digit <= 9; digit++) {
        const options = { code: `Digit${digit}`, key: String(digit), keyCode: 48 + digit };
        expect(dispatchKey('keydown', options).defaultPrevented).toBe(true);
        expect(dispatchKey('keydown', { ...options, repeat: true }).defaultPrevented).toBe(true);
        expect(dispatchKey('keyup', options).defaultPrevented).toBe(true);
      }
      expect(siteHandler).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', siteHandler, true);
      window.removeEventListener('keyup', siteHandler, true);
      document.removeEventListener('keydown', siteHandler, true);
    }
  });

  it('still executes a VSC number binding while blocking the site binding', () => {
    config.settings.keyBindings = [{ action: 'fast', code: 'Digit1', value: 1.25 }];
    dispatchKey('keydown', { code: 'Digit1', key: '1', keyCode: 49 });
    expect(actionHandler.runAction).toHaveBeenCalledWith('fast', 1.25, expect.any(KeyboardEvent));
  });

  it('blocks numpad keys, including empty event.key', () => {
    expect(dispatchKey('keydown', { code: 'Numpad2', key: '', keyCode: 98 }).defaultPrevented).toBe(
      true
    );
    expect(dispatchKey('keyup', { code: 'Numpad2', key: '', keyCode: 98 }).defaultPrevented).toBe(
      true
    );
  });

  it('leaves modifier combinations and ordinary text input alone', () => {
    expect(
      dispatchKey('keydown', { code: 'Digit1', key: '1', ctrlKey: true }).defaultPrevented
    ).toBe(false);
    const input = document.createElement('input');
    document.body.append(input);
    expect(dispatchKey('keydown', { code: 'Digit1', key: '1' }, input).defaultPrevented).toBe(
      false
    );
    dispatchKey('keydown', {}, input);
    vi.advanceTimersByTime(1000);
    expect(actionHandler.runAction).not.toHaveBeenCalled();
  });

  it('blocks numbers while a player slider has focus', () => {
    const slider = document.createElement('input');
    slider.type = 'range';
    document.body.append(slider);
    expect(dispatchKey('keydown', { code: 'Digit2', key: '2' }, slider).defaultPrevented).toBe(
      true
    );
  });

  it('recognizes a text field inside a shadow root', () => {
    const host = document.createElement('div');
    const input = document.createElement('input');
    host.attachShadow({ mode: 'open' }).append(input);
    document.body.append(host);
    expect(dispatchKey('keydown', { code: 'Digit1', key: '1' }, input).defaultPrevented).toBe(
      false
    );
  });
});
