<p align="center">
  <img src="../icon.svg" alt="dsh-remote-control" width="80" height="80">
</p>

<h1 align="center">dsh-remote-control</h1>

<div align="center">
  <p><strong>A small companion display for DSH, right beside your computer</strong></p>

  <p>
    <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/DSH_Plugin_for-_0.2.2--rc.5-4D6BFE?style=flat&logo=deepseek&logoColor=white" alt="DeepSeek Harness Plugin for 0.2.2-rc.5"></a>
    <a href="https://github.com/ohmykreee/dsh-remote-control/actions/workflows/checks.yml"><img src="https://github.com/ohmykreee/dsh-remote-control/actions/workflows/checks.yml/badge.svg" alt="Checks"></a>
    <a href="https://www.npmjs.com/package/@ohmykreee/dsh-remote-control"><img src="https://img.shields.io/npm/v/@ohmykreee/dsh-remote-control?style=flat&color=4D6BFE" alt="npm"></a>
    <img src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-4D6BFE?style=flat" alt="Windows / Linux / macOS">
    <a href="../LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat" alt="MIT License"></a>
  </p>

  <p><a href="../INSTALLATION.md">Installation guide</a> · <strong>English</strong> · <a href="../README.md">简体中文</a></p>
</div>

---

DSH runs in the background while a phone or tablet beside your computer shows its status and provides quick controls. See whether a session is waiting, how much you have spent today, or what is playing; answer a question, change tracks, or adjust the volume on the small screen.

The console connects to your computer over the LAN and opens in a browser, with no phone app to install. Its landscape, touch-friendly layout suits a screen that stays on your desk.

<p align="center">
  <img src="screenshots/en/overview.png" alt="Home and sessions" width="1000">
  <br>
  <em>Home and Sessions, in dark and light themes.</em>
</p>

## The six pages

| Page | Information and controls |
|---|---|
| Home | Check the time, weather and notifications; run a Pomodoro or countdown |
| Sessions | Check balance, spending and session progress; answer waiting questions |
| Quick Q&A | Hold to talk, pick a workspace, attach an image and ask follow-ups |
| Music | View artwork and progress, change tracks, pause and adjust system volume |
| Performance | Check CPU, memory, GPU, VRAM, clocks and temperatures |
| Custom page | Keep a web page of your choice inside the console; off by default |

<p align="center">
  <img src="screenshots/en/quickqa.png" alt="Quick Q&amp;A and the completed answer" width="1000">
  <br>
  <em>Quick Q&amp;A: hold to talk, with an optional image.</em>
</p>

<p align="center">
  <img src="screenshots/en/media.png" alt="Music and performance" width="1000">
  <br>
  <em>Music and Performance.</em>
</p>

## Get started

You can ask a DSH agent to install it. Start a new session and send:

> Install the `@ohmykreee/dsh-remote-control` plugin. Once installed, read its README.md and INSTALLATION.md, then follow those instructions to build the local component needed for media, volume, notifications, performance and location.

To install it yourself, follow the **[installation guide](../INSTALLATION.md)**. Then:

1. Restart DSH and open **Remote control → Connection** in the sidebar.
2. Connect your phone and computer to the same LAN, then scan the QR code.
3. Open the console in your phone browser. Add it to your home screen if you like; landscape is the best fit.

The clock, weather, sessions and balance work after installation. Media, volume, system notifications, GPU / temperatures and system location also need a local component built once on your computer. Without it, those items clearly show as unavailable, while CPU and memory still work.

Quick Q&A has one more prerequisite: enable DSH's official **Voice Input** plugin and load its speech model. Phone recording also needs a browser secure context such as HTTPS; the installation guide explains how to set that up.

## Connection and privacy

Use the address and QR code shown under **Connection**. If the default port is occupied, the console picks an available one. Open the full scanned link on your first visit; an address entered without its verification details will be rejected.

You can turn link verification off or rotate it, restrict accessible network interfaces, provide a certificate for HTTPS, and disconnect individual devices. Rotating verification invalidates existing links, which is useful after sharing one by mistake or changing devices.

The plugin does not upload sessions, notifications or settings to third-party services. Weather, city search and public-holiday lookups require internet access; QWeather uses your own account and quota.

## Platform support

| Platform | Support |
|---|---|
| Windows | Media, volume, performance, notifications and location |
| Linux | Media, volume, performance and notifications; NVIDIA / AMD GPUs work directly, while Intel GPU utilization needs an optional tool |
| macOS | Preliminary testing on macOS 26; GPU and temperatures are unavailable |
| Phone / tablet | A modern browser, optimised for 1280×800 landscape |

## Known limitations

- Session content is read-only on the phone. With **Push inquiries** enabled you can answer normal questions, but tool approvals still require DSH.
- A player that does not support seeking gets a read-only progress bar. NetEase Cloud Music likes and exact progress require an optional extra setup.
- NMC covers Chinese cities only; QWeather requires your own JWT credentials.
- Pomodoro and countdown timers run in the phone browser, so refreshing or closing the page loses the current timer.
- Quick Q&A depends on the official Voice Input plugin. The microphone and screen wake lock require a browser secure context.
- Without the local component, media, volume, notifications, GPU / temperatures and system location are unavailable. Everything else is unaffected.

Installation, updates, removal and recovery are covered in **[INSTALLATION.md](../INSTALLATION.md)**. Please use the repository Issues for bugs and feature requests.

## License

[MIT](../LICENSE). Inter, Noto Sans SC and JetBrains Mono use the SIL Open Font License 1.1. UI components come from MIT-licensed shadcn-svelte and bits-ui, and icons from ISC-licensed Lucide. Some media-adapter ideas are based on [Widdit/now-playing-service](https://github.com/Widdit/now-playing-service) (MIT).
