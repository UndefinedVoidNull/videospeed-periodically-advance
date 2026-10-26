# Video Speed Controller — Periodic Advance Fork

周期快进、按住临时倍速、独立鼠标快捷键，以及可以自由删改的快捷键设置。

Periodic advance, hold speed up, standalone mouse shortcuts, and fully editable shortcut settings.

[简体中文](#简体中文) · [English](#english)

## 简体中文

这是基于 [Video Speed Controller](https://github.com/igrigorik/videospeed) 的 fork。在保留 HTML5 视频/音频倍速控制、站点规则、记忆倍速和可拖动控制器等功能的基础上，增加更适合快速浏览长视频的播放方式。

### 为什么做这个 fork

如果你看 3x 或 4x 的采访视频时，会因为人物被加速的手势、肢体动作或镜头变化觉得目不暇接，甚至头晕，这正是这个 fork 想改善的观看体验。持续提高倍速，会把这些视觉运动一起加速；即使能跟上内容，也未必适合长时间观看。

**Periodically Advance（周期快进）通过间隔跳过内容来加快进度，保留下来的片段仍按基础倍速播放。** 例如，在 1x 下正常播放约 0.9 秒，再向前跳过 3 秒，如此循环。你看到的手势和动作保持正常速度，同时又能快速浏览后面的内容。

对于不适应持续 3x、4x 高速画面的人，这种“短暂观看，再跳过一段”的节奏可能更容易持续观看。它适合概览采访、课程、录屏或重复内容；跳过的片段不会播放，需要细看时可以随时暂停或退出周期快进。

### 新增与改进

| 功能                     | 使用价值                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| **Periodically Advance** | 自定义“每隔多少秒、向前跳过多少秒”，支持按住、切换和取消三种操作。                              |
| **Hold speed up**        | 按住快捷键临时使用指定倍速，松开恢复 1x，适合短暂加速。                                         |
| **独立鼠标快捷键**       | 鼠标侧键、中键和滚轮方向可以单独绑定，不需要组合键。                                            |
| **可自由删改的快捷键**   | 所有快捷键均可修改或删除，也可以全部清空；保存后不会自动补回。                                  |
| **数字键冲突修复**       | 在有受控媒体的页面，阻止普通数字键触发 YouTube 等站点的进度跳转，同时保留本扩展的数字键快捷键。 |

### 默认快捷键

| 快捷键          | 动作                        | 参数                   |
| --------------- | --------------------------- | ---------------------- |
| `1`             | Preferred speed             | 1.25x                  |
| `2`             | Preferred speed             | 1.5x                   |
| `3`             | Preferred speed             | 2x                     |
| `4`             | Preferred speed             | 3x                     |
| 反引号（&#96;） | Toggle periodically advance | 每 0.9 秒向前跳过 3 秒 |
| `0`             | Preferred speed             | 1x                     |

这些是新安装或执行 **Reset** 后的默认值。已有配置会保留；如需重置，建议先用 **Export** 备份。快捷键列表不再强制保留原有的显示控制器、增减倍速、前进、后退等条目，需要时可通过 **Add New** 自行添加。

### 为什么默认是 0.9 秒和 3 秒

这组默认值是快速浏览视频的经验起点：在部分采访、讲解视频中，粗略把一条字幕或一个分镜视作约 **3 秒** 的信息单元，并留出约 **0.9 秒** 的正常播放窗口，用来快速读字幕、观察画面和理解当前内容，再跳过一段继续浏览。

这里的 3 秒是**每次跳过的长度**，0.9 秒是**两次跳转之间的间隔**。在 1x 下，一个完整周期大约推进 `0.9 + 3 = 3.9` 秒的视频内容，并不是严格逐条字幕或逐个分镜采样。字幕长度、镜头节奏和阅读速度各不相同，可以增加间隔来留出更多理解时间，或缩短跳过长度来保留更多内容。

### 相当于多少倍速

在连续播放、定时器正常触发，并忽略跳转和缓冲开销时，播放进度的平均推进速度约为：

```text
等效进度倍速 ≈ 基础播放倍速 + 每次跳过秒数 ÷ 间隔秒数
```

默认配置在 **1x** 下约为 **4.33x**：`1 + 3 ÷ 0.9 ≈ 4.33`。

| 基础播放倍速 | 每 0.9 秒跳过 3 秒的等效进度倍速 |
| ------------ | -------------------------------- |
| 1x           | 约 4.33x                         |
| 1.25x        | 约 4.58x                         |
| 1.5x         | 约 4.83x                         |
| 2x           | 约 5.33x                         |
| 3x           | 约 6.33x                         |

**4.33x 描述的是进度推进速度，不是把保留下来的音视频加速到 4.33x。** 基础倍速为 1x 时，实际看到和听到的片段仍以 1x 播放，中间部分直接跳过。这是它与连续 4x 播放在观看体验上的主要区别。实际推进速度会受缓冲、跳转耗时和浏览器定时器调度影响。

### 动作与参数

在设置页的 **Shortcuts → Add New** 中选择动作：

| 动作名称                         | 行为                                         | 数值参数                                 |
| -------------------------------- | -------------------------------------------- | ---------------------------------------- |
| **Hold speed up**                | 按住时使用指定倍速，松开恢复 1x。            | 目标倍速，例如 `6`。                     |
| **Hold to periodically advance** | 按住时周期快进，松开停止。                   | 第一个值：跳过秒数；第二个值：间隔秒数。 |
| **Toggle periodically advance**  | 按一下开始，再按一下停止，松开按键不会停止。 | 第一个值：跳过秒数；第二个值：间隔秒数。 |
| **Cancel periodically advance**  | 停止任一种周期快进。                         | 无。                                     |

例如，要“每 0.9 秒快进 3 秒”，应依次填入 **`3`、`0.9`**，两个值都必须大于零。第一次跳转发生在一个间隔之后，按键自动重复不会加快跳转频率。

已暂停或结束的媒体不会执行周期快进；**暂停视频后画面会停住，恢复播放后继续周期快进**，不会补执行暂停期间的跳转。同一页面的其他受控媒体按各自的播放状态处理。

按住模式在松开、切换标签页、窗口失去焦点或进入文本输入框时结束。切换模式不要求持续按住，也不会因为失去焦点而自动取消；可用原快捷键、取消快捷键或状态按钮停止。离开页面、禁用扩展、修改快捷键或不再有受控媒体时，周期快进也会结束。

### 倍速旁的 A 状态按钮

- **普通 A**：当前未开启周期快进，点击开始。
- **带左上到右下斜线的 A**：周期快进已开启，点击退出。暂停视频时仍保持这个状态，方便恢复播放后继续。

**Preferences → Always Show Periodically Advance Status** 默认关闭。无论是否开启周期快进，A 都在鼠标悬停于倍速控制器时显示；勾选该选项后可常驻显示。按钮跟随控制器整体的显示与隐藏。

通过 A 开始时，优先使用上次的周期参数；没有记录时使用已配置的 Toggle/Hold 参数；没有相关快捷键时，使用默认的“每 0.9 秒跳过 3 秒”。

### 鼠标绑定与数字键

点击设置中的快捷键输入框，然后直接按鼠标侧键、中键或滚动滚轮，即可录入 **Mouse back / Mouse forward / Mouse middle / Wheel up / down / left / right**。

侧键和中键支持按住操作。滚轮没有松开事件，因此用于切换、取消或单次动作；连续滚动的一次滚轮动作簇只切换一次周期模式。匹配到已绑定的鼠标快捷键时，会拦截相应的浏览器后退、前进或滚动动作；未绑定的操作保持原有行为，Ctrl + 滚轮缩放也会保留。

数字键屏蔽包括主键盘和小键盘的普通 `0–9`，即使某个数字没有绑定本扩展动作，也会阻止它触发站点快捷键。文本输入和带修饰键的组合保持正常行为。

### 构建与安装

需要 npm，以及满足 [package.json](package.json) 中 `engines.node` 要求的 Node.js：22.x ≥ 22.22.2、24.x ≥ 24.15.0，或 ≥ 26.0.0。

在仓库目录执行：

```sh
npm ci
npm run build
```

1. 打开 Chrome 的 `chrome://extensions`，开启 **开发者模式**。
2. 点击 **加载已解压的扩展程序**。
3. 选择构建生成的 **`dist` 文件夹**。
4. 刷新视频页面，然后打开扩展设置调整快捷键。

本项目根目录的 `manifest.json` 是构建输入，完整的脚本和资源在 `dist` 中。也可以把 `dist` 的全部内容复制到其他文件夹后加载；目录名称不必叫 `dist`，但必须保留内部文件结构。

修改代码后重新运行 `npm run build`，在扩展管理页点击重新加载，再刷新视频页面。开发时可运行 `npm run dev` 监听脚本改动；运行 `npm test` 执行单元与集成测试。

## English

This fork builds on [Video Speed Controller](https://github.com/igrigorik/videospeed), retaining HTML5 video/audio speed control, site rules, remembered speeds, and the draggable controller while adding more ways to skim long videos.

### Why this fork exists

Sustained 3x or 4x playback can feel visually overwhelming. In interviews, even small hand gestures and body movements become noticeably rapid; camera changes are accelerated too. If that makes you feel dizzy or unable to watch for long, simply increasing playback speed may not suit your viewing style.

**Periodically Advance moves through a video by skipping at intervals, while the segments you actually watch retain the base playback speed.** At 1x, for example, it plays normally for about 0.9 seconds, skips forward 3 seconds, and repeats. The gestures and movements you see stay at normal speed while the playhead advances much faster.

For viewers who find continuous 3x or 4x motion uncomfortable, this watch-and-skip rhythm may be easier to sustain. It suits previews of interviews, lectures, recordings, and repetitive material. Skipped segments are omitted; pause or leave the mode whenever you want to inspect something closely.

### Additions and improvements

| Feature                        | What it offers                                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Periodically Advance**       | Configurable skip length and interval, with hold, toggle, and cancel actions.                                                                                                   |
| **Hold speed up**              | Use a chosen speed while held; release returns to 1x.                                                                                                                           |
| **Standalone mouse shortcuts** | Bind side buttons, the middle button, or wheel directions without modifiers.                                                                                                    |
| **Fully editable shortcuts**   | Change or remove every binding, including all defaults. An empty list stays empty after saving.                                                                                 |
| **Number-key conflict fix**    | On pages with controlled media, block plain digits from triggering site shortcuts such as YouTube percentage seeking, while keeping this extension's digit bindings functional. |

### Default shortcuts

| Shortcut          | Action                      | Value                            |
| ----------------- | --------------------------- | -------------------------------- |
| `1`               | Preferred speed             | 1.25x                            |
| `2`               | Preferred speed             | 1.5x                             |
| `3`               | Preferred speed             | 2x                               |
| `4`               | Preferred speed             | 3x                               |
| Backquote (&#96;) | Toggle periodically advance | Skip 3 seconds every 0.9 seconds |
| `0`               | Preferred speed             | 1x                               |

These defaults apply to new installations and **Reset**. Existing settings are preserved; use **Export** before resetting if you want a backup. Controller visibility, speed adjustment, rewind, and advance bindings are no longer mandatory rows. Add any of them with **Add New**.

### Why 0.9 seconds and 3 seconds?

These defaults are a viewing heuristic for skimming: treat a subtitle or shot lasting roughly **3 seconds** as an approximate information unit in some interviews and explanatory videos, and allow about **0.9 seconds** of normal playback to glance at subtitles, observe the frame, and grasp the current idea before skipping ahead.

The 3 seconds is the **skip length**, and 0.9 seconds is the **interval between skips**. At 1x, a complete cycle advances about `0.9 + 3 = 3.9` seconds of video; it does not sample every subtitle or shot individually. Subtitle length, editing pace, and reading speed vary. Increase the interval for more reading time or reduce the skip length to retain more content.

### What is the equivalent speed?

During continuous playback, with on-time timer ticks and negligible seeking or buffering overhead:

```text
Equivalent timeline speed ≈ base playback speed + skip seconds ÷ interval seconds
```

At **1x**, the default is approximately **4.33x**: `1 + 3 ÷ 0.9 ≈ 4.33`.

| Base playback speed | Equivalent timeline speed with a 3-second skip every 0.9 seconds |
| ------------------- | ---------------------------------------------------------------- |
| 1x                  | About 4.33x                                                      |
| 1.25x               | About 4.58x                                                      |
| 1.5x                | About 4.83x                                                      |
| 2x                  | About 5.33x                                                      |
| 3x                  | About 6.33x                                                      |

**4.33x describes timeline progress, not the playback speed of the retained audio and video.** With a 1x base, the segments you see and hear still play at 1x; the intervening content is skipped. This is the main viewing difference from continuous 4x playback. Buffering, seek latency, and browser timer scheduling affect actual progress.

### Actions and parameters

Choose an action under **Shortcuts → Add New**:

| Action                           | Behavior                                                           | Numeric parameters                             |
| -------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------- |
| **Hold speed up**                | Use the chosen speed while held; release returns to 1x.            | Target speed, such as `6`.                     |
| **Hold to periodically advance** | Advance periodically while held; release stops it.                 | First: skip seconds. Second: interval seconds. |
| **Toggle periodically advance**  | Press once to start and again to stop. Releasing does not stop it. | First: skip seconds. Second: interval seconds. |
| **Cancel periodically advance**  | Stop either periodic mode.                                         | None.                                          |

For “skip 3 seconds every 0.9 seconds,” enter **`3`, then `0.9`**. Both values must be positive. The first skip happens after one interval; keyboard auto-repeat does not accelerate the timer.

Paused or ended media are not advanced. **Pausing freezes the frame; resuming playback resumes periodic advances**, without replaying missed ticks. Other controlled media on the same page follow their own playback state.

Hold actions end on release, a tab switch, window blur, or focus entering a text field. Toggle mode requires no held input and remains enabled across focus changes. Stop it with the same shortcut, a cancel shortcut, or the status button. Leaving the page, disabling the extension, changing bindings, or losing all controlled media also ends periodic advance.

### The A status button

- **Plain A:** periodic advance is off. Click to start.
- **A with a top-left-to-bottom-right diagonal slash:** periodic advance is on. Click to stop. It remains in this state while paused so playback can resume in the same mode.

**Preferences → Always Show Periodically Advance Status** is off by default. A appears when hovering over the speed controller, whether periodic advance is active or inactive. Turn the option on to keep A visible. The button follows the controller's overall visibility.

Starting from A reuses the last periodic parameters, then a configured Toggle/Hold binding, then the default of skipping 3 seconds every 0.9 seconds if no relevant binding exists.

### Mouse bindings and number keys

Click a shortcut field and press a side/middle button or scroll to record **Mouse back / Mouse forward / Mouse middle / Wheel up / down / left / right**.

Side and middle buttons support holds. Wheel directions support toggle, cancel, and single actions because scrolling has no release event. A continuous wheel burst counts as one periodic toggle. A matched mouse binding consumes the corresponding browser navigation or scrolling action. Unbound inputs retain their normal behavior, including Ctrl + wheel zoom.

Plain `0–9` keys on the main keyboard and number pad are blocked from site shortcuts while media is controlled, even if a digit has no extension binding. Text input and modifier combinations retain their normal behavior.

### Build and install

Use npm and a Node.js version matching `engines.node` in [package.json](package.json): 22.x ≥ 22.22.2, 24.x ≥ 24.15.0, or ≥ 26.0.0.

Run from the repository directory:

```sh
npm ci
npm run build
```

1. Open `chrome://extensions` in Chrome and enable **Developer mode**.
2. Click **Load unpacked**.
3. Select the generated **`dist` directory**.
4. Refresh video pages and open the extension settings to customize shortcuts.

The repository-root `manifest.json` is a build input. The complete scripts and assets are generated in `dist`. You can copy all of its contents into another directory and load that instead; the directory name is arbitrary, but its internal structure must remain intact.

After code changes, run `npm run build`, reload the extension in Chrome, and refresh video pages. Use `npm run dev` to watch script changes, or `npm test` to run unit and integration tests.

## 致谢与许可 / Credits and license

- 基于 / Based on [igrigorik/videospeed](https://github.com/igrigorik/videospeed), by Ilya Grigorik and contributors.
- **Hold speed up** 的按住加速、松开恢复 1x 行为移植自 UndefinedVoidNull 的参考实现（commit `3e21d4d`）。 / The hold-to-speed-up and release-to-1x behavior was ported from UndefinedVoidNull's reference implementation (commit `3e21d4d`).
- [MIT License](LICENSE). Original copyright © 2014 Ilya Grigorik.
