import { vi } from 'vitest';
import { createMockVideo } from '../helpers/test-utils.js';

describe('Periodic advance follows each media playback state', () => {
  let manager;
  let handler;
  let media;

  function video(paused = false) {
    const element = createMockVideo({ paused });
    element.vsc = { div: document.createElement('div') };
    return element;
  }

  function key(type, code = 'KeyT') {
    document.body.dispatchEvent(
      new KeyboardEvent(type, { code, key: code.slice(-1), bubbles: true })
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
    media = [video()];
    vi.spyOn(window.VSC.stateManager, 'getControlledElements').mockImplementation(() => media);
    const config = {
      settings: {
        keyBindings: [
          { action: 'holdAdvance', code: 'KeyH', value: 3, interval: 0.5 },
          { action: 'toggleAdvance', code: 'KeyT', value: 3, interval: 0.5 },
          { action: 'cancelAdvance', code: 'KeyC', value: 0 },
        ],
      },
    };
    manager = new window.VSC.EventManager(config, null);
    handler = new window.VSC.ActionHandler(config, manager);
    manager.actionHandler = handler;
    vi.spyOn(handler, 'seek').mockImplementation((element, seconds) => {
      element.currentTime += seconds;
    });
    manager.setupKeyboardShortcuts(document);
  });

  afterEach(() => {
    manager.cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each(['KeyH', 'KeyT'])('%s skips paused media and resumes without catching up', (code) => {
    media[0].pause();
    key('keydown', code);
    if (code === 'KeyT') {
      key('keyup', code);
    }
    vi.advanceTimersByTime(4000);
    expect(media[0].currentTime).toBe(0);
    expect(handler.seek).not.toHaveBeenCalled();
    media[0].play();
    vi.advanceTimersByTime(500);
    expect(media[0].currentTime).toBe(3);
    expect(handler.seek).toHaveBeenCalledTimes(1);
    media[0].pause();
    vi.advanceTimersByTime(2000);
    expect(media[0].currentTime).toBe(3);
    media[0].play();
    vi.advanceTimersByTime(500);
    expect(media[0].currentTime).toBe(6);
    expect(handler.seek).toHaveBeenCalledTimes(2);
  });

  it.each(['KeyH', 'KeyT'])(
    '%s leaves paused siblings still while playing media advances',
    (code) => {
      const paused = video(true);
      const ended = video();
      Object.defineProperty(ended, 'ended', { value: true });
      media.push(paused, ended);
      key('keydown', code);
      vi.advanceTimersByTime(1000);
      expect(media[0].currentTime).toBe(6);
      expect(paused.currentTime).toBe(0);
      expect(ended.currentTime).toBe(0);
      paused.play();
      media[0].pause();
      vi.advanceTimersByTime(500);
      expect(media[0].currentTime).toBe(6);
      expect(paused.currentTime).toBe(3);
      expect(ended.currentTime).toBe(0);
    }
  );

  it.each(['KeyH', 'KeyT'])('%s can be stopped while paused without restarting on play', (code) => {
    key('keydown', code);
    if (code === 'KeyT') {
      key('keyup', code);
    }
    vi.advanceTimersByTime(500);
    media[0].pause();
    if (code === 'KeyH') {
      key('keyup', code);
    } else {
      key('keydown', 'KeyC');
    }
    media[0].play();
    vi.advanceTimersByTime(2000);
    expect(media[0].currentTime).toBe(3);
    expect(manager.heldActions.size).toBe(0);
    expect(manager.periodicAdvance).toBeNull();
  });

  it('keeps manual advance available while paused', () => {
    media[0].pause();
    handler.runAction('advance', 10);
    expect(media[0].currentTime).toBe(10);
    expect(media[0].paused).toBe(true);
  });
});
