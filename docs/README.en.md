<p align="center">
  <img src="../icon.svg" alt="dsh-remote-control" width="80" height="80">
</p>

<h1 align="center">dsh-remote-control</h1>

<div align="center">
  <p><strong>A touch-first LAN console for DeepSeek Harness</strong></p>
  <p><em>把局域网里的手机变成 DSH 的触屏中控台</em></p>

  <p>
    <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat&logo=deepseek&logoColor=white" alt="Powered by dsh"></a>
    <a href="https://github.com/ohmykreee/dsh-remote-control/actions/workflows/checks.yml"><img src="https://github.com/ohmykreee/dsh-remote-control/actions/workflows/checks.yml/badge.svg" alt="Checks"></a>
    <img src="https://img.shields.io/badge/version-v1.0.0-4D6BFE?style=flat" alt="v1.0.0">
    <img src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-4D6BFE?style=flat" alt="Windows / Linux / macOS">
    <a href="../LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat" alt="MIT License"></a>
  </p>

  <p>
    Install steps → <a href="../INSTALLATION.md">INSTALLATION.md</a>
  </p>

  <p>
    <strong>English</strong> · <a href="../README.md">简体中文</a>
  </p>
</div>

---

When your phone and computer share a LAN, open the console address in the phone browser and DSH becomes a touch panel: clock, weather and system notifications; sessions and balance at a glance; playback and system volume; and answers to a session that is waiting on you. The plugin runs in the DSH Desktop / `dsh web` host process, and the phone receives snapshots over WebSocket without refreshing the page.

## The pages

Four pages, each with one job:

| Page | What it shows |
|---|---|
| Home | Large clock and date, current weather with hourly / 7-day forecast, Pomodoro or countdown, system notifications |
| Sessions | Account balance, today / this week spend, a 7-day spend chart behind the spend card, live sessions and subagents, remote answers |
| Music | Full-bleed blurred artwork, track info, progress and seek, previous / next, play-pause, system volume and mute, NetEase Cloud Music like |
| Performance | CPU / memory and GPU / VRAM rings, clocks and uptime, hottest temperature and sensor list |

<p align="center">
  <img src="screenshots/en/overview.png" alt="Home, sessions, music and performance" width="1000">
  <br>
  <em>Home / Sessions / Music / Performance (top-left / top-right / bottom-left / bottom-right). Each capture is split from top-right to bottom-left: dark above, light below.</em>
</p>

<p align="center">
  <img src="screenshots/en/question.png" alt="Remote question" width="640">
  <br>
  <em>Remote question: options, the recommended marker and a custom reply.</em>
</p>

- The four pages loop horizontally, one page per gesture; page order, enablement and the navigation rail position (left / right / top / bottom) are configured on the DSH settings page.
- Disabled pages disappear from the phone rail and stop polling their data.
- In landscape each page is exactly one screen tall, with notifications, sessions and temperature sensors scrolling inside their cards; only portrait allows the whole page to scroll.
- The phone UI ships in Simplified Chinese and English. **Follow DSH** matches the current DSH locale exactly and falls back to English when there is no translation.
- Small screens get larger type and touch targets of at least 44 px; there are no hover transitions or scale animations.
- A quick refresh button and a fullscreen button sit at the bottom left.

## Install

The repository contains source only: `index.js`, `client.js`, `lib/`, `web/` and `native/bin/` are produced by a local build. So the only supported install path is **from source on GitHub** — clone, build, then register the source directory with `link:` in a DSH profile. There is no npm package, and pasting the repository URL into the plugin manager will not work.

Prerequisites: DSH with third-party bundle support (verified on `0.2.2-rc.1`), Node.js `>= 22`, pnpm and git; Rust is only needed for the native probe.

```bash
git clone https://github.com/ohmykreee/dsh-remote-control.git
cd dsh-remote-control
pnpm install
```

The `postinstall` step builds the host, the phone UI and, when the toolchain is available, the Rust probe.

```bash
# DSH Desktop; use --profile web for dsh web
dsh plugin --profile desktop add "link:/absolute/path/dsh-remote-control"
```

On Windows, prefer forward slashes in the spec, for example `link:D:/path/to/dsh-remote-control`. You can also install from a local path in the DSH plugin manager. Restart DSH afterwards; **Remote control** appears in the sidebar.

Full prerequisites, probe builds, updates, uninstall and recovery are in [`INSTALLATION.md`](../INSTALLATION.md).

## Pairing

- Open **Remote control → Connection** in the sidebar, then scan the pairing QR code with the phone or copy the console address. Phone and computer must be on the same LAN.
- A random access token is enabled by default. The `?token=` in the address is exchanged for a cookie on the phone; a missing token returns a 401 page. The token can be disabled or rotated, and rotating disconnects every connected device.
- Access can be limited to selected network interfaces / subnets; loopback is always allowed.
- Optional HTTPS: point the plugin at a PEM certificate and private key. An invalid certificate falls back to HTTP and reports the error on the connection page.
- The default port is `38765`; override it with `DSH_REMOTE_CONTROL_PORT`. If the port is taken, the server falls back to a random free one.

## Settings

The **Remote control** sidebar has these groups:

| Group | Contents |
|---|---|
| Connection | QR code, console address, allowed interfaces, link verification, HTTPS certificate |
| Preferences | Plugin language, temperature unit, theme, page order and toggles, navigation position |
| Pomodoro / countdown | Enable switch (mutually exclusive), focus / break lengths, 1–5 countdown presets, alert sound |
| Weather | Auto / manual location, city search, hourly / 7-day display, request location access |
| Balance display | This week / last 7 days, low-balance threshold, peak / off-peak badge |
| Notification settings | Per-app toggles, display limit (1–20), push questions |
| App mapping | Rename apps or reset them to their defaults |
| System info | Service status, probe / Node.js, profile, connected devices, diagnostics |

Settings are held as a draft and submitted together with **Save settings**; app renames, theme sync, token rotation and disconnecting devices apply immediately.

## Pomodoro and countdown

Both sit between the clock and the weather on the phone, are **mutually exclusive**, and unload completely when disabled. Timers run only in the phone browser, so refreshing or closing the page loses the current count.

| | Pomodoro | Countdown |
|---|---|---|
| Setup | Focus / break lengths, optional "ring until stopped" | 1–5 presets in seconds (1–86400), 3 by default |
| At zero | Plays the alert sound, optionally looping until stopped | Card turns red and shows "Time's up"; you must confirm |
| Controls | Start, pause, reset | Pick a preset, start, pause, reset; reset and presets are locked until confirmed |

- The alert sound can be a local audio file or an http(s) URL configured in DSH; leave it empty for the built-in soft arpeggio. Countdown and Pomodoro share it.
- At zero the browser tab shows a green dot, and the countdown also vibrates the phone when the browser supports it.

## Weather

- Auto mode prefers system location; if that is denied or unavailable it falls back to IP geolocation (`https://ipwho.is/`), then to the timezone.
- Windows location can be blocked by system privacy switches. **Weather settings → Request location access** on the settings page triggers the prompt; when denied it opens the Windows Location settings page, and after granting access the cached location is cleared and weather refreshes immediately.
- Manual mode searches for a city and fills in the name, latitude and longitude; coordinates can also be edited directly. City names missing an administrative suffix (for example "Xiamen") are retried with the suffix appended.
- City search and forecasts both use Open-Meteo through the host, with no API key. Temperature units support Celsius and Fahrenheit; switching applies to weather, forecasts and the performance sensors with full unit symbols.
- In auto mode the manual location fields are read-only.

## Sessions and balance

- Balance comes from the DSH account API. Usage supports two windows: **this week** (since Monday 00:00) and **last 7 days** (today plus the previous six calendar days).
- The sessions page shows a per-day spend chart for the last 7 days, drawn behind the spend card with the highest day at full height.
- Session states are running (green), waiting for an answer (yellow), error (red) and finished; the rail icon shows yellow / red dots while a session is waiting or has errored.
- Subagent sessions are nested inside the card of the agent that spawned them and indented to the right; running sessions show the accumulated runtime reported by DSH.
- The balance card has a peak / off-peak badge in its top-right corner: weekdays 09:00–12:00 and 14:00–18:00 Beijing time are peak (mountain icon); all other hours, weekends and public holidays are off-peak (moon icon, half the peak price). The time check runs in the phone browser, holidays come from timor.tech, and the badge can be hidden under **Balance display**.

### Remote answers

With **Push questions** enabled, a session that is waiting for an answer gets an "Answer" entry. Tap it to open a centered touch dialog with every question, its options and a custom-reply field. Single-choice questions answer on tap; multiple-choice questions accept several selections, and you can also type a custom reply or skip a question.

- Answers go back to the agent through DSH's normal `user-questions/request` waterfall; continued questions that are still answerable after a timeout go through `userQuestions.answer`.
- Only normal DSH user questions (`ask_user_question`) are supported. Tool approvals still have to be handled in DSH; the phone offers no remote approval.
- DSH's own question card still appears and may need to be dismissed manually after a remote answer — that is the current DSH web client behaviour.
- With the switch off, the sessions page stays read-only.

## Music

- Supports NetEase Cloud Music, QQ Music, Kugou, Kuwo, Qishui, Quanmin K Ge, Spotify, Apple Music, YouTube Music, browsers and other SMTC / MPRIS players.
- Media reading identifies the player first: a built-in vendor adapter takes over when the app is known, and only unknown players go straight to the system API. The system API is WinRT SMTC on Windows, MPRIS on Linux, and `nowplaying-cli` / AppleScript on macOS (source-level implementation).
- The page shows artwork, a full-bleed blurred background, track info, progress, previous / next, play-pause, system volume and mute. The NetEase like button is clickable when CDP is available. Artwork supports data URLs and http(s) URLs; a placeholder is shown when the backend returns none.
- Progress is rendered by a custom `SeekBar` with the same look as a shadcn control and advanced by a local 100 ms clock, so cached snapshots cannot pull it backwards. While playing, the played portion is an advancing sine wave; on pause, drag or an invalid timeline it flattens into a line. When no progress is available, nothing is faked. A drag commits exactly one seek on release.
- Automatic seek and volume changes hold the target value briefly so player state echoing back cannot snap the UI.

**Where a draggable seek comes from**:

| Source | Progress | Draggable seek |
|---|---|---|
| Complete system session (SMTC / MPRIS / MediaRemote) | Yes | **Yes** |
| NetEase CDP-only (no SMTC session) | Yes | No |
| Incomplete system session (`smtc-partial`) | When a duration exists | No |
| Private window title / Cider title | When available | No |
| UI Automation / AX | When available | No |

A "complete system session" requires a title, a valid timeline (`EndTime > StartTime > 0`), a player that allows seeking, and at least one non-zero position actually received. Some older clients are additionally checked for position evidence.

### NetEase Cloud Music

- When the system API is available it provides metadata, artwork, playback state and transport controls; CDP only adds precise progress and the like state.
- When the system API is unavailable but CDP works, track info, artwork URL, progress, like and playback controls all come from CDP — but **CDP never grants seek**.
- When neither works, window / UIA fallbacks are tried, and an empty result is returned rather than fabricated data.
- Without CDP the like state is unknown; the local database is not read. CDP listens on loopback only, calls no external data APIs and never exports cookies. See [`INSTALLATION.md`](../INSTALLATION.md#网易云音乐-cdp可选红心精确进度) for setup.

No external track or artwork APIs are called: with SMTC the NetEase artwork comes from SMTC; in CDP-only mode the artwork URL from the client's track data is loaded and cached by the control browser; only the window-title fallback uses the local cache.

## Performance

- Two cards on the left show CPU / memory and GPU / VRAM, with utilization drawn as rings; small tiles below show current clocks, uptime, used / available memory, VRAM and core / memory clocks.
- The right-hand temperature column keeps the large hottest temperature and sensor heat backgrounds, listing GPU core, disk and ACPI sensors together and scrolling inside the card when there are many.
- CPU temperature can only come from ACPI thermal zones; when the board does not expose one it shows "Not provided" instead of inventing a reading.
- Performance data comes from the optional native probe. Without it, CPU / memory fall back to plain JS while GPU and temperatures show empty / error states; GPU and temperature probing stops while the performance page is disabled.

## Notifications and app mapping

- Windows reads the notification centre database and reports the raw application id; Linux watches D-Bus notifications; macOS reads the notification centre database (source-level, untested). Chinese display names come from the Node-side app mapping.
- The plugin maintains `app-mapping.json`, recording every app seen, its source (notifications / music), first and last seen times and notification counts, plus any custom name.
- Notification avatars support data URLs and http(s) images.
- Built-in defaults cover common Windows apps (QQ, Bilibili, Discord, Terminal, VS Code, Edge, Outlook and more); other apps are derived from the executable name, AUMID or MPRIS name.
- On the **App mapping** settings page each app can be renamed or reset to its default, effective immediately for phone notifications and music source labels. The old `notification-cache.json` is migrated automatically on first start.
- **Notification settings** toggles notifications per app, sets the display limit (1–20) and controls whether questions are pushed.

## Security and privacy

- A random token is on by default; it can be disabled or rotated, and rotating disconnects every WebSocket. Access can be limited to selected interfaces / subnets, with loopback always allowed.
- Optional HTTPS; an invalid certificate falls back to HTTP and reports the error. Every write endpoint additionally checks that `Origin` matches `Host`, and request bodies are capped at 64 KiB.
- Settings live in `DSH_HOME/remote-control/settings.json` (or under `DSH_PROFILE_DIR` when set); app history and mapping live in `app-mapping.json` in the same directory.
- The repository contains no local paths, tokens, certificates or notification content, and there is no telemetry.
- External requests only happen for explicit features: weather and city search use Open-Meteo, the IP fallback uses ipwho.is, and public holidays use timor.tech. Everything else stays on the LAN, served by the host.

## Platform support

| Platform | Status |
|---|---|
| Windows | Fully supported. The Rust probe provides SMTC media and control, Core Audio volume, DXGI / PDH / WDDM performance and temperatures, notification centre and WinRT location; no PowerShell / C# fallbacks. |
| Linux | Fully supported. MPRIS, `wpctl` / `pactl` / `amixer` volume, sysinfo / sysfs performance, D-Bus notification watch and GeoClue2 location; GPU support covers NVIDIA / AMD only. |
| macOS | Source-level implementation, not verified on hardware or in CI. Media / volume / performance / notifications are present; GPU and temperatures are not implemented and location falls back to IP. |
| Phone | A modern browser with WebSocket; the layout prefers 1280×800 landscape. |

## Known limitations

- The Rust probe must be built locally; no binaries are committed. Without it, media, volume, notifications, GPU and temperatures show "probe unavailable", system location falls back to IP / timezone, and CPU / memory still work.
- Windows location needs system privacy permission and Medium integrity; a low-integrity workspace rejects location permanently and must be repaired as described in the install guide.
- Private media layers (window title / Cider title) are read-only: they can show the track and progress, but control still depends on a complete SMTC / MPRIS session. Accessibility layers never grant seek.
- The NetEase CDP store depends on the page's webpack runtime and may not inject after a page reload; it then falls back to the player-bar DOM, and progress can be briefly missing right after a track change.
- The sessions page is read-only; media and volume are writable; tool approvals cannot be handled remotely.
- Pomodoro and countdown run only in the phone browser tab, so refreshing or closing the page loses them.
- The layout is tuned for 1280×800 landscape; portrait is a compact fallback.

## Documentation

| File | Contents |
|---|---|
| [`INSTALLATION.md`](../INSTALLATION.md) | Install, build, native probe, update, uninstall, recovery |
| [`README.md`](../README.md) | Chinese README |
| [`AGENTS.md`](../AGENTS.md) | Architecture, protocols, build and tests; for developers and agents |

Bugs and feature requests go to the repository Issues.

## License

[MIT](../LICENSE). Inter, Noto Sans SC and JetBrains Mono are licensed under the SIL Open Font License 1.1 (`static/fonts/LICENSE.txt`, copied to `web/fonts/LICENSE.txt` after a build). UI components come from MIT-licensed shadcn-svelte and bits-ui, icons from ISC-licensed Lucide, and the media adapter layer references the MIT-licensed [Widdit/now-playing-service](https://github.com/Widdit/now-playing-service).
