import { vi } from 'vitest';

describe('Background migration preserves deleted shortcuts', () => {
  let storage;
  let onInstalled;
  let save;

  beforeEach(() => {
    vi.resetModules();
    save = vi.fn(async (items) => Object.assign(storage, items));
    vi.stubGlobal('chrome', {
      storage: {
        sync: {
          get: async (defaults) =>
            defaults === null ? { ...storage } : { ...defaults, ...storage },
          set: save,
          remove: async () => {},
        },
        onChanged: { addListener() {} },
      },
      runtime: {
        onInstalled: {
          addListener(handler) {
            onInstalled = handler;
          },
        },
        onStartup: { addListener() {} },
      },
      action: { setIcon: async () => {} },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('updates legacy keys without reinserting deleted actions', async () => {
    storage = {
      schemaVersion: 1,
      keyBindings: [{ action: 'fast', key: 49, value: 1.25, predefined: false }],
    };
    await import('../../../src/background.js');
    await onInstalled();
    expect(storage.schemaVersion).toBe(2);
    expect(storage.keyBindings).toEqual([
      {
        action: 'fast',
        key: 49,
        keyCode: 49,
        code: 'Digit1',
        displayKey: '1',
        value: 1.25,
        predefined: false,
      },
    ]);
  });

  it('leaves an explicitly empty list empty during an extension update', async () => {
    storage = { schemaVersion: 1, keyBindings: [] };
    await import('../../../src/background.js');
    await onInstalled();
    expect(storage.keyBindings).toEqual([]);
    expect(save).not.toHaveBeenCalled();
  });

  it('preserves both hold parameters in existing settings', async () => {
    storage = {
      schemaVersion: 2,
      keyBindings: [
        { action: 'holdAdvance', code: 'Backquote', key: 192, value: 3, interval: 0.5 },
      ],
    };
    await import('../../../src/background.js');
    await onInstalled();
    expect(storage.keyBindings).toHaveLength(1);
    expect(storage.keyBindings[0].interval).toBe(0.5);
    expect(save).not.toHaveBeenCalled();
  });
});
