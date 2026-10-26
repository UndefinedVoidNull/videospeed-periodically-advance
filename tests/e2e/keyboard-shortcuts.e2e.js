import puppeteer from 'puppeteer';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { sleep } from './e2e-utils.js';

export default async function runKeyboardShortcutTests() {
  let passed = 0;
  let failed = 0;
  const browser = await puppeteer.launch({
    headless: true,
    pipe: true,
    enableExtensions: [resolve('dist')],
    args: ['--allow-file-access-from-files'],
  });
  const runTest = async (name, test) => {
    try {
      await test();
      console.log(`   ✅ ${name}`);
      passed++;
    } catch (error) {
      console.error(`   ❌ ${name}: ${error.message}`);
      failed++;
    }
  };
  try {
    const worker = await browser.waitForTarget((target) => target.type() === 'service_worker');
    const extensionId = new URL(worker.url()).host;
    const options = await browser.newPage();
    const optionsUrl = `chrome-extension://${extensionId}/ui/options/options.html`;
    await options.goto(optionsUrl);
    await options.waitForSelector('.customs');
    await options.setViewport({ width: 900, height: 760 });

    await runTest(
      'new defaults match the requested speed keys, 0 key and periodic toggle',
      async () => {
        const rows = await options.$$eval('.customs', (elements) =>
          elements.map((row) => ({
            action: row.querySelector('.customDo').value,
            label: row.querySelector('.customDo').selectedOptions[0].textContent,
            key: row.querySelector('.customKey').value,
            value: Number(row.querySelector('.customValue').value),
            interval: Number(row.querySelector('.customInterval').value),
            removable: !!row.querySelector('.removeParent'),
            editable: !row.querySelector('.customDo').disabled,
          }))
        );
        assert(rows.length === 6, `expected 6 rows, got ${rows.length}`);
        assert(
          rows.every((row) => row.removable && row.editable),
          'all rows must be editable and removable'
        );
        assert(
          JSON.stringify(rows.map((row) => row.value)) === '[1.25,1.5,2,3,3,1]',
          'preferred speeds match request'
        );
        assert(
          rows[4].action === 'toggleAdvance' && rows[4].interval === 0.9,
          'toggle interval is 0.9s'
        );
        assert(
          rows[4].label === 'Toggle periodically advance',
          'toggle action uses the requested name'
        );
        assert(rows[5].key === '0' && rows[5].action === 'fast', '0 selects preferred speed 1x');
        await mkdir(resolve('tests/e2e/screenshots'), { recursive: true });
        await options.screenshot({ path: resolve('tests/e2e/screenshots/shortcuts-defaults.png') });
      }
    );

    const page = await browser.newPage();
    const fixtureUrl = pathToFileURL(resolve('tests/e2e/keyboard-shortcuts.html')).href;
    const loadFixture = async () => {
      await page.goto(fixtureUrl);
      await page.bringToFront();
      await page.waitForFunction(() => !!document.querySelector('video')?.vsc);
      await page.$eval('video', (video) => video.play());
    };
    await loadFixture();

    await runTest('digits never reach site handlers registered before document_idle', async () => {
      for (const digit of '0123456789') {
        await page.keyboard.press(digit);
      }
      const events = await page.evaluate(() => window.siteNumberEvents);
      assert(events.length === 0, `site received ${JSON.stringify(events)}`);
      await page.keyboard.press('0');
      assert((await page.$eval('video', (video) => video.playbackRate)) === 1, '0 selects 1x');
      await page.keyboard.press('1');
      const rate = await page.$eval('video', (video) => video.playbackRate);
      assert(rate === 1.25, `VSC number shortcut still works, got ${rate}`);
    });

    await runTest(
      'text fields accept digits, but a focused player slider keeps them blocked',
      async () => {
        await page.focus('#text');
        await page.keyboard.type('123');
        assert(
          (await page.$eval('#text', (input) => input.value)) === '123',
          'text input receives digits'
        );
        await page.evaluate(() => {
          window.siteNumberEvents = [];
        });
        await page.focus('#slider');
        await page.keyboard.press('5');
        assert(
          (await page.evaluate(() => window.siteNumberEvents.length)) === 0,
          'slider focus must not bypass blocking'
        );
      }
    );

    const statusState = () =>
      page.$eval('video', (video) => {
        const button = video.vsc.div.shadowRoot.querySelector('#periodic-advance-status');
        const slash = getComputedStyle(button, '::after');
        return {
          hidden: getComputedStyle(button).display === 'none',
          active: button.getAttribute('aria-pressed') === 'true',
          underlined: getComputedStyle(button).textDecorationLine.includes('underline'),
          slashed: !['none', 'normal'].includes(slash.content) && slash.transform !== 'none',
          adjacent: button.previousElementSibling === video.vsc.speedIndicator,
          speed: video.playbackRate,
          paused: video.paused,
        };
      });
    const hoverStatus = async () => {
      const point = await page.$eval('video', (video) => {
        const rect = video.vsc.speedIndicator.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      });
      await page.mouse.move(point.x, point.y);
    };
    const clickStatus = async () => {
      await hoverStatus();
      const point = await page.$eval('video', (video) => {
        const rect = video.vsc.div.shadowRoot
          .querySelector('#periodic-advance-status')
          .getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      });
      await page.mouse.click(point.x, point.y);
    };
    const captureStatus = async (name, hovered = false) => {
      if (hovered) {
        await hoverStatus();
      } else {
        await page.mouse.move(700, 400);
      }
      const clip = await page.$eval('video', (video) => {
        const rect = video.vsc.div.shadowRoot.querySelector('#controller').getBoundingClientRect();
        return {
          x: Math.max(0, rect.x - 5),
          y: Math.max(0, rect.y - 5),
          width: Math.ceil(rect.width + 10),
          height: Math.ceil(rect.height + 10),
        };
      });
      await page.screenshot({ path: resolve(`tests/e2e/screenshots/${name}.png`), clip });
    };

    await runTest(
      'A appears on hover in both modes by default, and clicking cancels even while paused',
      async () => {
        await page.mouse.move(700, 400);
        let state = await statusState();
        assert(
          state.hidden && !state.active && !state.slashed && !state.underlined,
          'inactive A is hidden without hovering by default'
        );
        await hoverStatus();
        assert(!(await statusState()).hidden, 'hovering over the speed reveals inactive A');
        await clickStatus();
        state = await statusState();
        assert(
          !state.hidden && state.active && state.slashed,
          'clicking A starts periodic advance'
        );
        await page.mouse.move(700, 400);
        state = await statusState();
        assert(state.hidden && state.active, 'active A also hides when the pointer leaves');
        await page.keyboard.press('Backquote');
        state = await statusState();
        assert(state.hidden && !state.active, 'keyboard stop keeps A hidden without hovering');
        await page.keyboard.press('Backquote');
        state = await statusState();
        assert(state.hidden && state.active, 'keyboard start keeps A hidden without hovering');
        await hoverStatus();
        state = await statusState();
        assert(
          !state.hidden && state.active && state.slashed && !state.underlined && state.adjacent,
          'enabled A has a diagonal slash beside the speed'
        );
        await page.$eval('video', (video) => video.pause());
        state = await statusState();
        assert(state.active && !state.hidden, 'pause keeps the mode indicator enabled');
        await captureStatus('periodic-status-active', true);
        await clickStatus();
        const stopped = await statusState();
        assert(
          !stopped.hidden && !stopped.active && !stopped.slashed && !stopped.underlined,
          'clicking slashed A cancels and restores plain A'
        );
        assert(
          stopped.speed === state.speed && stopped.paused,
          'status click preserves speed and pause'
        );
        await page.mouse.move(700, 400);
        assert((await statusState()).hidden, 'inactive A hides again when the pointer leaves');
        await page.$eval('video', (video) => video.play());
      }
    );

    await runTest(
      'Always Show defaults to off, persists an opt-in, and keeps A visible in both modes',
      async () => {
        await options.bringToFront();
        const selector = '#alwaysShowPeriodicallyAdvanceStatus';
        assert(
          await options.$eval(selector, (input) => !input.checked),
          'always-show defaults to off'
        );
        await options.click('#save');
        await options.waitForSelector('#save.saved');
        await options.reload();
        await options.waitForSelector('.customs');
        assert(
          await options.$eval(selector, (input) => !input.checked),
          'hover-only preference persists after reload'
        );
        await options.click(selector);
        await options.click('#save');
        await options.waitForSelector('#save.saved');
        await options.reload();
        await options.waitForSelector('.customs');
        assert(
          await options.$eval(selector, (input) => input.checked),
          'explicit always-show opt-in persists after reload'
        );
        await page.bringToFront();
        await page.waitForFunction(
          () => window.VSC_controller.config.settings.alwaysShowPeriodicallyAdvanceStatus
        );
        await page.mouse.move(700, 400);
        let state = await statusState();
        assert(
          !state.hidden && !state.active && !state.slashed && !state.underlined,
          'inactive A is plain'
        );
        await captureStatus('periodic-status-inactive');
        await clickStatus();
        await page.mouse.move(700, 400);
        state = await statusState();
        assert(
          !state.hidden && state.active && state.slashed && !state.underlined,
          'clicking A enables it with a diagonal slash'
        );
        await clickStatus();
        await page.mouse.move(700, 400);
        state = await statusState();
        assert(
          !state.hidden && !state.active && !state.slashed && !state.underlined,
          'clicking again restores plain A'
        );
        await clickStatus();
      }
    );

    await runTest(
      'changing only the status preference preserves a running periodic mode',
      async () => {
        await options.bringToFront();
        await options.click('#alwaysShowPeriodicallyAdvanceStatus');
        await options.click('#save');
        await options.waitForSelector('#save.saved');
        await page.bringToFront();
        await page.waitForFunction(
          () => !window.VSC_controller.config.settings.alwaysShowPeriodicallyAdvanceStatus
        );
        await page.mouse.move(700, 400);
        const active = await statusState();
        assert(
          active.active && active.hidden,
          `turning always-show off hides A without stopping the mode: ${JSON.stringify(active)}`
        );
        await hoverStatus();
        const hovered = await statusState();
        assert(
          !hovered.hidden && hovered.active && hovered.slashed && !hovered.underlined,
          'hovering still reveals slashed active A after the live change'
        );
        await clickStatus();
        await page.mouse.move(700, 400);
        assert((await statusState()).hidden, 'A hides after stopping with preference off');
        await hoverStatus();
        assert(!(await statusState()).hidden, 'inactive A is still available on hover');
      }
    );

    await runTest('hold advance fires on its clock and stops on release', async () => {
      await page.evaluate(() => {
        document.activeElement.blur();
        window.VSC_controller.config.settings.keyBindings = [
          { action: 'holdAdvance', code: 'Backquote', key: 192, value: 3, interval: 0.5 },
        ];
        const handler = window.VSC_controller.actionHandler;
        const seek = handler.seek.bind(handler);
        window.seekCalls = [];
        handler.seek = (video, seconds) => {
          window.seekCalls.push(seconds);
          seek(video, seconds);
        };
      });
      await page.keyboard.down('Backquote');
      await sleep(1150);
      await page.keyboard.up('Backquote');
      const calls = await page.evaluate(() => window.seekCalls);
      assert(
        calls.length === 2 && calls.every((seconds) => seconds === 3),
        `expected two 3s seeks, got ${calls}`
      );
      await sleep(650);
      assert((await page.evaluate(() => window.seekCalls.length)) === 2, 'release stops interval');
    });

    await runTest(
      'hold parameters and legacy removable rows survive options Save and reload',
      async () => {
        await options.bringToFront();
        await options.evaluate(async () => {
          await chrome.storage.sync.set({
            keyBindings: [
              { action: 'display', code: 'KeyV', key: 86, value: 0, predefined: true },
              { action: 'holdSpeed', code: 'Backquote', key: 192, displayKey: '`', value: 6 },
              {
                action: 'holdAdvance',
                code: 'KeyH',
                key: 72,
                displayKey: 'h',
                value: 4,
                interval: 0.25,
              },
            ],
          });
        });
        await options.reload();
        await options.waitForSelector('.customs');
        assert(
          await options.$eval('.customs .customDo', (select) => !select.disabled),
          'legacy dropdown unlocked'
        );
        await options.click('.customs .removeParent');
        await options.click('#save');
        await options.waitForFunction(
          async () => (await chrome.storage.sync.get('keyBindings')).keyBindings.length === 2
        );
        await options.reload();
        await options.waitForSelector('.customs');
        const stored = await options.evaluate(
          async () => (await chrome.storage.sync.get('keyBindings')).keyBindings
        );
        assert(
          stored[1].value === 4 && stored[1].interval === 0.25,
          'both hold parameters survive Save'
        );
        await loadFixture();
      }
    );

    await runTest('hold speed up uses 6x and returns to 1x after release', async () => {
      await page.keyboard.down('Backquote');
      assert((await page.$eval('video', (video) => video.playbackRate)) === 6, 'press sets 6x');
      await page.keyboard.down('Backquote');
      assert(
        (await page.$eval('video', (video) => video.playbackRate)) === 6,
        'repeat does not toggle speed'
      );
      await page.keyboard.up('Backquote');
      assert(
        (await page.$eval('video', (video) => video.playbackRate)) === 1,
        'release restores 1x'
      );
    });

    await runTest(
      'rejects a zero toggle interval and a wheel direction assigned to a hold',
      async () => {
        await options.bringToFront();
        await options.select('.customs:first-child .customDo', 'toggleAdvance');
        await options.$eval('.customs:first-child .customInterval', (input) => {
          input.value = '0';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await options.click('#save');
        assert(
          await options.$eval(
            '.customs:first-child .customInterval',
            (input) => !input.validity.valid
          ),
          'zero interval is invalid'
        );
        assert(
          await options.$eval('#save', (button) => button.classList.contains('has-changes')),
          'invalid settings do not appear saved'
        );
        await options.select('.customs:first-child .customDo', 'holdAdvance');
        await options.$eval('.customs:first-child .customInterval', (input) => {
          input.value = '0.5';
        });
        await options.click('.customs:first-child .customKey');
        await options.mouse.wheel({ deltaY: -100 });
        await options.waitForFunction(
          () => document.querySelector('.customKey').code === 'WheelUp'
        );
        await options.click('#save');
        assert(
          await options.$eval('.customs:first-child .customKey', (input) => !input.validity.valid),
          'wheel input cannot be saved as a hold'
        );
        const stored = await options.evaluate(
          async () => (await chrome.storage.sync.get('keyBindings')).keyBindings
        );
        assert(stored[0].action === 'holdSpeed', 'invalid edits never overwrite saved settings');
        await options.reload();
        await options.waitForSelector('.customs');
      }
    );

    await runTest(
      'records standalone side, middle and wheel bindings and saves both periodic parameters',
      async () => {
        await options.bringToFront();
        await options.evaluate(async () => {
          await chrome.storage.sync.set({
            keyBindings: [
              {
                action: 'toggleAdvance',
                code: 'KeyT',
                key: 84,
                displayKey: 't',
                value: 3,
                interval: 0.2,
              },
              { action: 'cancelAdvance', code: 'KeyC', key: 67, displayKey: 'c', value: 0 },
              {
                action: 'holdAdvance',
                code: 'KeyH',
                key: 72,
                displayKey: 'h',
                value: 2,
                interval: 0.15,
              },
            ],
          });
        });
        await options.reload();
        await options.waitForSelector('.customs');
        const inputSelector = (index) => `.customs:nth-child(${index}) .customKey`;
        await options.evaluate(() => history.pushState({}, '', '?recording'));
        const beforeSideButtonUrl = options.url();
        await options.click(inputSelector(1));
        await options.mouse.down({ button: 'back' });
        await options.mouse.up({ button: 'back' });
        assert(
          options.url() === beforeSideButtonUrl,
          'recording a side button does not navigate back'
        );
        await options.click(inputSelector(2));
        await options.mouse.wheel({ deltaY: 100 });
        await options.waitForFunction(
          () => document.querySelectorAll('.customKey')[1].code === 'WheelDown'
        );
        await options.click(inputSelector(3));
        await options.mouse.down({ button: 'middle' });
        await options.mouse.up({ button: 'middle' });
        await options.click('#save');
        await options.waitForSelector('#save.saved');
        const stored = await options.evaluate(
          async () => (await chrome.storage.sync.get('keyBindings')).keyBindings
        );
        assert.deepEqual(
          stored.map((binding) => binding.code),
          ['MouseBack', 'WheelDown', 'MouseMiddle']
        );
        assert(
          stored.every((binding) => !binding.modifiers),
          'mouse inputs need no modifiers'
        );
        assert(stored[0].interval === 0.2 && stored[0].value === 3, 'toggle keeps both parameters');
        assert(!('interval' in stored[1]), 'cancel has no interval parameter');
        const hidden = await options.$eval(
          '.customs:nth-child(2)',
          (row) =>
            row.querySelector('.customValue').hidden && row.querySelector('.customInterval').hidden
        );
        assert(hidden, 'cancel hides both numeric inputs');
        await options.reload();
        await options.waitForSelector('.customs');
        assert(
          (await options.$eval(inputSelector(1), (input) => input.value)) === 'Mouse back',
          'mouse label survives reload'
        );
        assert(
          await options.$$eval('.customKey', (inputs) =>
            inputs.every((input) => input.scrollWidth <= input.clientWidth)
          ),
          'mouse labels fit without clipping'
        );
        await options.screenshot({ path: resolve('tests/e2e/screenshots/shortcuts-mouse.png') });
        await loadFixture();
        await page.evaluate(() => {
          const handler = window.VSC_controller.actionHandler;
          const seek = handler.seek.bind(handler);
          window.seekCalls = [];
          handler.seek = (video, seconds) => {
            window.seekCalls.push(seconds);
            seek(video, seconds);
          };
          history.pushState({}, '', '#side-button-test');
        });
      }
    );

    await runTest(
      'a side button toggles periodic advance without navigating the browser',
      async () => {
        const originalUrl = page.url();
        await page.mouse.move(650, 250);
        await page.mouse.down({ button: 'back' });
        await page.mouse.up({ button: 'back' });
        await page.waitForFunction(() => window.seekCalls.length >= 2);
        assert(page.url() === originalUrl, 'bound side button does not navigate');
        await page.mouse.down({ button: 'back' });
        await page.mouse.up({ button: 'back' });
        const count = await page.evaluate(() => window.seekCalls.length);
        await sleep(350);
        assert(
          (await page.evaluate(() => window.seekCalls.length)) === count,
          'second press cancels timer'
        );
      }
    );

    await runTest(
      'standalone wheel cancel stops the timer and middle-button hold stops on release',
      async () => {
        await page.mouse.down({ button: 'back' });
        await page.mouse.up({ button: 'back' });
        await page.waitForFunction(() => !!window.VSC_controller.eventManager.periodicAdvance);
        await page.mouse.wheel({ deltaY: 100 });
        await page.waitForFunction(() => !window.VSC_controller.eventManager.periodicAdvance);
        const cancelledCount = await page.evaluate(() => window.seekCalls.length);
        await sleep(350);
        assert(
          (await page.evaluate(() => window.seekCalls.length)) === cancelledCount,
          'wheel cancel stops seeking'
        );
        await page.mouse.down({ button: 'middle' });
        await page.waitForFunction(
          (before) => window.seekCalls.length >= before + 2,
          {},
          cancelledCount
        );
        await page.mouse.up({ button: 'middle' });
        const releasedCount = await page.evaluate(() => window.seekCalls.length);
        await sleep(300);
        assert(
          (await page.evaluate(() => window.seekCalls.length)) === releasedCount,
          'middle-button release stops seeking'
        );
        const lastSeek = await page.evaluate(() => window.seekCalls.at(-1));
        assert(lastSeek === 2, 'mouse hold uses its own seek parameter');
      }
    );

    await runTest(
      'a wheel direction can toggle repeatedly and live settings install the wheel binding',
      async () => {
        await options.bringToFront();
        await options.click('.customs:first-child .customKey');
        await options.mouse.wheel({ deltaY: -100 });
        await options.waitForFunction(
          () => document.querySelector('.customKey').code === 'WheelUp'
        );
        await options.click('#save');
        await options.waitForSelector('#save.saved');
        await page.bringToFront();
        await page.waitForFunction(
          () => window.VSC_controller.config.settings.keyBindings[0].code === 'WheelUp'
        );
        const before = await page.evaluate(() => window.seekCalls.length);
        await page.mouse.wheel({ deltaY: -100 });
        await page.mouse.wheel({ deltaY: -20 });
        await page.mouse.wheel({ deltaY: -10 });
        await page.waitForFunction((count) => window.seekCalls.length >= count + 2, {}, before);
        await page.mouse.wheel({ deltaY: -100 });
        await page.waitForFunction(() => !window.VSC_controller.eventManager.periodicAdvance);
        const stopped = await page.evaluate(() => window.seekCalls.length);
        await sleep(350);
        assert(
          (await page.evaluate(() => window.seekCalls.length)) === stopped,
          'next wheel burst stops the timer'
        );
      }
    );

    await runTest('both periodic modes freeze while paused and resume with playback', async () => {
      await page.evaluate(() => {
        document.activeElement.blur();
        const manager = window.VSC_controller.eventManager;
        manager.cancelPeriodicAdvance();
        manager.clearHeldActions();
        manager.config.settings.keyBindings = [
          { action: 'holdAdvance', code: 'KeyH', value: 0.1, interval: 0.1 },
          { action: 'toggleAdvance', code: 'KeyT', value: 0.1, interval: 0.1 },
          { action: 'cancelAdvance', code: 'KeyC', value: 0 },
        ];
      });
      for (const code of ['KeyH', 'KeyT']) {
        await page.$eval('video', (video) => video.pause());
        await page.evaluate(() => {
          window.seekCalls = [];
        });
        await page.keyboard.down(code);
        if (code === 'KeyT') {
          await page.keyboard.up(code);
        }
        await sleep(350);
        assert(
          (await page.evaluate(() => window.seekCalls.length)) === 0,
          `${code}: enabling while paused never seeks`
        );
        await page.$eval('video', (video) => video.play());
        await page.waitForFunction(() => window.seekCalls.length >= 2);
        const paused = await page.evaluate(() => {
          const video = document.querySelector('video');
          video.pause();
          return { time: video.currentTime, count: window.seekCalls.length };
        });
        await sleep(350);
        assert(
          (await page.evaluate(() => window.seekCalls.length)) === paused.count,
          `${code}: pause stops every periodic seek`
        );
        assert(
          (await page.$eval('video', (video) => video.currentTime)) === paused.time,
          `${code}: paused frame stays fixed`
        );
        await page.$eval('video', (video) => video.play());
        await page.waitForFunction((count) => window.seekCalls.length > count, {}, paused.count);
        await page.$eval('video', (video) => video.pause());
        if (code === 'KeyH') {
          await page.keyboard.up(code);
        } else {
          await page.keyboard.press('KeyC');
        }
        const stopped = await page.evaluate(() => window.seekCalls.length);
        await page.$eval('video', (video) => video.play());
        await sleep(300);
        assert(
          (await page.evaluate(() => window.seekCalls.length)) === stopped,
          `${code}: stopped modes do not restart on playback`
        );
      }
    });

    await runTest(
      'deleting every shortcut stays empty after Save, reload and fixture initialization',
      async () => {
        await options.bringToFront();
        await options.$$eval('.customs .removeParent', (buttons) =>
          buttons.forEach((button) => button.click())
        );
        await options.click('#save');
        await options.waitForFunction(
          async () => (await chrome.storage.sync.get('keyBindings')).keyBindings.length === 0
        );
        await options.reload();
        await options.waitForFunction(() => !!window.VSC?.videoSpeedConfig?._loaded);
        assert((await options.$$('.customs')).length === 0, 'empty settings stay empty');
        await loadFixture();
        await page.keyboard.press('1');
        assert(
          (await page.$eval('video', (video) => video.playbackRate)) === 1,
          'deleted binding does not execute'
        );
        const stored = await options.evaluate(
          async () => (await chrome.storage.sync.get('keyBindings')).keyBindings
        );
        assert(stored.length === 0, 'content startup never repopulates deleted bindings');
        await page.evaluate(() => {
          document
            .querySelector('video')
            .vsc.div.shadowRoot.querySelector('[data-action="faster"]')
            .click();
        });
        assert(
          (await page.$eval('video', (video) => video.playbackRate)) === 1.1,
          'controller buttons work without keyboard bindings'
        );
      }
    );
  } finally {
    await browser.close();
  }
  return { passed, failed };
}
