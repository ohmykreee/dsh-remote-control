#!/usr/bin/env python3
"""Serve the built web console with deterministic demo data for screenshots.

This is development tooling, not part of the plugin runtime. It copies the
Vite output to a temporary directory, injects a fake WebSocket that emits the
same envelopes as the Host, and serves the result with a short artificial load
delay so a screen capture includes the rendered data.

Usage (run after `pnpm build:web`):

    python3 scripts/mock-preview.py --web web --port 4173 --locale zh --theme dark --freeze-clock
    # http://127.0.0.1:4173/?page=music
    # http://127.0.0.1:4173/?page=home&sheet=1   (opens the question dialog)

For README images, show the preview on the real device screen
(`scripts/screenshot-device.sh`) and compose the dark/light captures with
`scripts/screenshot-compose.py`. `--freeze-clock` keeps the rendered clock
identical across the two captures.

The mock cover is a generated SVG; no image library or network access needed.
"""

from __future__ import annotations

import argparse
import functools
import http.server
import json
import math
import shutil
import socketserver
import sys
import time
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def iso_at(hour: int, minute: int = 0) -> str:
    return f"{datetime.now():%Y-%m-%d}T{hour:02d}:{minute:02d}:00"


def ago(seconds: int) -> int:
    return int(time.time() * 1000) - seconds * 1000


# Demo copy that exists only in the mock payloads. Keep it exact: the English
# preview translates whole strings, so changing a sentence here also changes the
# English preview.
DEMO_EN = {
    "演示城区": "Demo City",
    "演示工作区": "Demo workspace",
    "产品文档": "Product docs",
    "客户端应用": "Client app",
    "基础设施": "Infrastructure",
    "日历": "Calendar",
    "产品评审会": "Product review",
    "今天 18:30，线上会议 · 预计 45 分钟": "Today 18:30, online meeting · ~45 min",
    "邮件": "Mail",
    "新的设计交接说明": "New design handoff notes",
    "附带了最新的界面规范和组件清单，请查收。": "Includes the latest UI spec and component list.",
    "消息中心": "Messages",
    "存储空间提醒": "Storage reminder",
    "本月的备份已完成，当前占用空间 62%。": "This month's backup is complete; 62% used.",
    "提醒事项": "Reminders",
    "整理明天的待办": "Tidy tomorrow's to-do",
    "还有 3 项任务没有完成": "3 tasks are still open",
    "系统": "System",
    "更新已就绪": "Update ready",
    "新的系统更新将在空闲时安装。": "The new system update will install when idle.",
    "本周": "This week",
    "六": "Sat",
    "日": "Sun",
    "一": "Mon",
    "二": "Tue",
    "三": "Wed",
    "四": "Thu",
    "五": "Fri",
    "重写远端控制台界面": "Rewrite the remote console UI",
    "正在核对页面间距与卡片层级…": "Checking page spacing and card hierarchy…",
    "拆分组件样式": "Split component styles",
    "把全局规则收回各自的 Svelte 组件。": "Move global rules back into their Svelte components.",
    "核对配色与间距": "Check colors and spacing",
    "颜色变量与卡片间距已统一。": "Color variables and card spacing are now unified.",
    "确认首页信息密度": "Confirm home information density",
    "时钟、天气与通知的层级是否合适？": "Are the clock, weather and notification levels right?",
    "首页": "Home",
    "首页右侧的通知区域是否保留完整列表？": "Should the home screen keep the full notification list on the right?",
    "保留完整列表（推荐）": "Keep the full list (Recommended)",
    "可以滚动查看全部通知，信息更完整。": "Scroll to see every notification; more complete.",
    "只显示前三条": "Show only the first three",
    "视觉更轻，但会隐藏部分通知。": "Lighter visually, but hides some notifications.",
    "移到独立页面": "Move to a separate page",
    "首页更专注，但需要多一次跳转。": "A more focused home, at the cost of one extra tap.",
    "整理演示数据": "Tidy demo data",
    "已生成用于展示的示例内容。": "Generated sample content for the demo.",
    "磁盘 0": "Disk 0",
    "磁盘 1": "Disk 1",
}


def translate_demo(value, locale: str):
    if locale != "en":
        return value
    if isinstance(value, str):
        return DEMO_EN.get(value, value)
    if isinstance(value, list):
        return [translate_demo(item, locale) for item in value]
    if isinstance(value, dict):
        return {key: translate_demo(item, locale) for key, item in value.items()}
    return value



def demo_payloads(locale: str = "zh", timer: str = "pomodoro", theme: str = "dark") -> list[dict]:
    settings = {
        "theme": theme,
        "locale": locale,
        "temperatureUnit": "celsius",
        "pushQuestions": True,
        "navPosition": "left",
        "pageOrder": ["home", "sessions", "quickqa", "music", "performance"],
        "pageEnabled": {"home": True, "sessions": True, "quickqa": True, "music": True, "performance": True},
        "quickqa": {
            "voiceReady": True,
            "defaultWorkspaceId": "ws-demo",
            "defaultWorkspaceTitle": "演示工作区",
            "pinned": [
                {"id": "ws-docs", "title": "产品文档", "path": "D:\\demo\\docs"},
                {"id": "ws-app", "title": "客户端应用", "path": "D:\\demo\\app"},
                {"id": "ws-infra", "title": "基础设施", "path": "D:\\demo\\infra"},
            ],
            "pushQuestions": True,
            "allowImages": True,
        },
        "pomodoro": {
            "enabled": timer == "pomodoro",
            "focusMinutes": 25,
            "breakMinutes": 5,
            "soundPath": "",
            "loopAlarm": False,
        },
        "countdown": {
            "enabled": timer == "countdown",
            "presets": [60, 300, 600],
        },
        "balance": {"spendWindow": "week", "lowThreshold": 50, "showPeakValley": True},
    }

    weather = {
        "ok": True,
        "location": {"name": "演示城区"},
        "current": {
            "code": 2,
            "temperature": 19.4,
            "feelsLike": 18.2,
            "humidity": 58,
            "windSpeed": 12,
            "isDay": True,
        },
        "daily": {
            "high": 23.8,
            "low": 16.9,
            "sunrise": iso_at(6, 22),
            "sunset": iso_at(17, 47),
            "tomorrowHigh": 24,
            "tomorrowLow": 17,
        },
        "hourly": [
            {"time": iso_at(17), "code": 2, "temperature": 19},
            {"time": iso_at(18), "code": 1, "temperature": 18},
            {"time": iso_at(19), "code": 1, "temperature": 17},
            {"time": iso_at(20), "code": 3, "temperature": 17},
            {"time": iso_at(21), "code": 3, "temperature": 16},
            {"time": iso_at(22), "code": 61, "temperature": 16},
        ],
        "dailyForecast": [],
        "forecastMode": "hourly",
    }

    notifications = {
        "available": True,
        "notifications": [
            {
                "id": "n1",
                "appKey": "calendar",
                "appName": "日历",
                "title": "产品评审会",
                "body": "今天 18:30，线上会议 · 预计 45 分钟",
                "receivedAt": ago(8 * 60),
            },
            {
                "id": "n2",
                "appKey": "mail",
                "appName": "邮件",
                "title": "新的设计交接说明",
                "body": "附带了最新的界面规范和组件清单，请查收。",
                "receivedAt": ago(27 * 60),
            },
            {
                "id": "n3",
                "appKey": "messages",
                "appName": "消息中心",
                "title": "存储空间提醒",
                "body": "本月的备份已完成，当前占用空间 62%。",
                "receivedAt": ago(45 * 60),
            },
            {
                "id": "n4",
                "appKey": "todo",
                "appName": "提醒事项",
                "title": "整理明天的待办",
                "body": "还有 3 项任务没有完成",
                "receivedAt": ago(60 * 60),
            },
            {
                "id": "n5",
                "appKey": "system",
                "appName": "系统",
                "title": "更新已就绪",
                "body": "新的系统更新将在空闲时安装。",
                "receivedAt": ago(2 * 60 * 60),
            },
        ],
    }

    account = {
        "available": True,
        "signedIn": True,
        "lowBalance": True,
        "lowThreshold": 50,
        "balance": {
            "currency": "CNY",
            "balance": 12.34,
            "paid": 12.34,
            "bonus": 0,
            "state": "ready",
        },
        "usage": {
            "currency": "CNY",
            "state": "ready",
            "today": 9.05,
            "spend": 78.82,
            "spendLabel": "本周",
            "daily": [
                {"label": "六", "cost": 6.4},
                {"label": "日", "cost": 4.2},
                {"label": "一", "cost": 18.6},
                {"label": "二", "cost": 12.8},
                {"label": "三", "cost": 15.4},
                {"label": "四", "cost": 12.3},
                {"label": "五", "cost": 9.05},
            ],
        },
    }

    sessions = [
        {
            "id": "s-main",
            "title": "重写远端控制台界面",
            "status": "running",
            "preview": "正在核对页面间距与卡片层级…",
            "turn": 4,
            "runningSince": ago(3 * 60 + 43),
            "lastActiveAt": ago(12),
        },
        {
            "id": "s-child-1",
            "title": "拆分组件样式",
            "status": "running",
            "preview": "把全局规则收回各自的 Svelte 组件。",
            "turn": 2,
            "runningSince": ago(79),
            "lastActiveAt": ago(8),
            "parentId": "s-main",
            "isSubagent": True,
        },
        {
            "id": "s-child-2",
            "title": "核对配色与间距",
            "status": "done",
            "preview": "颜色变量与卡片间距已统一。",
            "turn": 5,
            "lastActiveAt": ago(6 * 60),
            "parentId": "s-main",
            "isSubagent": True,
        },
        {
            "id": "s-question",
            "title": "确认首页信息密度",
            "status": "question",
            "preview": "时钟、天气与通知的层级是否合适？",
            "turn": 2,
            "lastActiveAt": ago(70),
            "pending": {
                "kind": "question",
                "requestId": "q-1",
                "answerable": True,
                "questions": [
                    {
                        "id": "q-1-1",
                        "header": "首页",
                        "question": "首页右侧的通知区域是否保留完整列表？",
                        "options": [
                            {"label": "保留完整列表（推荐）", "description": "可以滚动查看全部通知，信息更完整。"},
                            {"label": "只显示前三条", "description": "视觉更轻，但会隐藏部分通知。"},
                            {"label": "移到独立页面", "description": "首页更专注，但需要多一次跳转。"},
                        ],
                    }
                ],
            },
        },
        {
            "id": "s-done",
            "title": "整理演示数据",
            "status": "done",
            "preview": "已生成用于展示的示例内容。",
            "turn": 11,
            "lastActiveAt": ago(4 * 60 * 60),
        },
    ]

    performance = {
        "cpu": {
            "usage": 11,
            "model": "AMD Ryzen 7 5700X3D 8-Core Processor",
            "cores": 16,
            "physicalCores": 8,
            "speed": 3810,
            "uptime": 23840,
        },
        "memory": {"total": 17179869184, "used": 9930014720, "free": 7249854464, "percent": 58},
        "gpu": {
            "ok": True,
            "name": "AMD Radeon RX 7800 XT",
            "utilization": 2,
            "memoryUsed": 2791728742,
            "memoryTotal": 17179869184,
            "memoryPercent": 16,
            "coreClockMhz": 231,
            "memoryClockMhz": 2418,
            "driver": "32.0.23033.1002",
        },
        "temperatures": [
            {"name": "AMD Radeon RX 7800 XT", "celsius": 57.0},
            {"name": "磁盘 0", "celsius": 41.0},
            {"name": "磁盘 1", "celsius": 47.0},
        ],
        "backend": "demo",
        "sampledAt": int(time.time() * 1000),
    }

    media = {
        "ok": True,
        "media": {
            "media": {
                "appId": "spotify",
                "appName": "Spotify",
                "title": "Midnight City",
                "artist": "M83",
                "albumArtist": "M83",
                "album": "Hurry Up, We're Dreaming",
                "playbackStatus": "Playing",
                "position": 96,
                "startTime": 0,
                "endTime": 244,
                "canSeek": True,
                "positionReported": True,
                "canPlayPause": True,
                "canNext": True,
                "canPrevious": True,
                "liked": True,
                "canLike": True,
                "canSetLiked": True,
                "thumbnail": "/mock-cover.svg",
                "thumbnailUrl": None,
            },
            "error": None,
        },
        "volume": {"volume": 0.62, "muted": False},
    }

    overview = {
        "settings": settings,
        "weather": weather,
        "notifications": notifications,
        "account": account,
        "sessions": sessions,
        "sessionsError": None,
        "performance": performance,
    }

    messages = [
        {"type": "welcome", "settings": settings},
        {"type": "overview", "data": overview},
        {"type": "media", "data": media},
        {"type": "performance", "data": performance},
        {"type": "clients", "data": []},
    ]
    return translate_demo(messages, locale)


def mock_socket_script(messages: list[dict], locale: str) -> str:
    return (
        """
(function () {
  const params = new URLSearchParams(location.search);
  const wantSheet = params.get('sheet') === '1';
  const quickDemo = params.get('quickqa');
  const wantImage = params.get('image') !== '0' && (params.get('image') === '1' || quickDemo === 'done' || quickDemo === 'result');
  const pinScrollTop = params.get('scroll') === 'top';
  const MESSAGES = __MESSAGES__;
  const MOCK_LOCALE = __LOCALE__;
  const copy = (zh, en) => MOCK_LOCALE === 'en' ? en : zh;
  const MOCK_IMAGE = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480">'
    + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
    + '<stop offset="0" stop-color="#ffb46b"/><stop offset="0.55" stop-color="#e75d8d"/><stop offset="1" stop-color="#5b6cff"/>'
    + '</linearGradient></defs><rect width="480" height="480" fill="url(#g)"/>'
    + '<circle cx="330" cy="150" r="74" fill="#fff" opacity="0.72"/>'
    + '<path d="M0 360 L150 210 L270 330 L360 250 L480 370 L480 480 L0 480 Z" fill="#121a2b" opacity="0.35"/>'
    + '</svg>',
  );
  const mockImageState = () => {
    const quickqa = window.__DSH_QUICKQA__;
    if (!quickqa || !wantImage) return false;
    if (quickDemo) {
      const message = quickqa.messages.find((entry) => entry.role === 'user' && !entry.imageUrl);
      if (!message) return false;
      message.imageUrl = MOCK_IMAGE;
      return true;
    }
    if (quickqa.attachedImage) return true;
    quickqa.attachedImage = { blob: new Blob(), mediaType: 'image/png', url: MOCK_IMAGE };
    return true;
  };
  let mockImageAttempts = 0;
  const mockImageTimer = setInterval(() => {
    mockImageAttempts += 1;
    if (mockImageState() || mockImageAttempts > 40) clearInterval(mockImageTimer);
  }, 250);
  if (params.get('companion') === '1') {
    // Fake the companion bridge so the VR screenshot button can be previewed.
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 480;
    const context = canvas.getContext('2d');
    const sky = context.createLinearGradient(0, 0, 480, 480);
    sky.addColorStop(0, '#5b6cff');
    sky.addColorStop(0.55, '#e75d8d');
    sky.addColorStop(1, '#ffb46b');
    context.fillStyle = sky;
    context.fillRect(0, 0, 480, 480);
    context.fillStyle = 'rgba(255,255,255,0.24)';
    context.beginPath();
    context.moveTo(0, 360);
    context.lineTo(150, 210);
    context.lineTo(270, 330);
    context.lineTo(360, 250);
    context.lineTo(480, 370);
    context.lineTo(480, 480);
    context.lineTo(0, 480);
    context.closePath();
    context.fill();
    context.fillStyle = 'rgba(255,255,255,0.9)';
    context.font = '600 42px sans-serif';
    context.fillText('VR', 208, 190);
    const capture = () => new Promise((resolve, reject) => {
      setTimeout(() => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('mock capture failed'))), 'image/png');
      }, 1200);
    });
    window.__DSH_COMPANION__ = Object.freeze({
      version: 1,
      platform: 'windows',
      capabilities: Object.freeze({ vrScreenshot: true }),
      captureVrScreenshot: capture,
    });
    window.dispatchEvent(new Event('dsh-companion-ready'));
  }
  if (params.get('capturing') === '1') {
    let captureAttempts = 0;
    const captureTimer = setInterval(() => {
      captureAttempts += 1;
      const quickqa = window.__DSH_QUICKQA__;
      if (quickqa) {
        quickqa.phase = 'capturing';
        clearInterval(captureTimer);
      } else if (captureAttempts > 40) {
        clearInterval(captureTimer);
      }
    }, 250);
  }
  if (pinScrollTop) {
    setInterval(() => {
      const body = document.querySelector('.quickqa-conversation-body');
      if (body && body.scrollTop > 0) body.scrollTop = 0;
    }, 250);
  }
  class MockSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this._listeners = { open: [], message: [], close: [], error: [] };
      setTimeout(() => {
        this.readyState = 1;
        this._emit('open', {});
        for (const message of MESSAGES) this._emit('message', { data: JSON.stringify(message) });
        if (quickDemo) {
          const sessionId = 's-quickqa-demo';
          const push = (payload) => this._emit('message', { data: JSON.stringify(payload) });
          const state = (phase, question) => push({ type: 'quickqa-state', phase, sessionId, workspaceId: 'ws-demo', ...(question ? { question } : {}) });
          setTimeout(() => {
            if (quickDemo === 'thinking') {
              state('thinking', '演示问题：帮我总结今天的工作安排。');
            } else if (quickDemo === 'streaming') {
              state('thinking', '演示问题：现在项目进展如何？');
              state('streaming');
              const chunks = ['这是', '一份', '流式', '回答', '。'];
              let index = 0;
              const timer = setInterval(() => {
                if (index >= chunks.length) { clearInterval(timer); return; }
                push({ type: 'quickqa-delta', text: chunks[index++], sessionId });
              }, 160);
            } else if (quickDemo === 'done') {
              state('thinking', copy(
                '演示问题：请把今天从早到晚的安排、会议、待办和依赖关系整理成一个可以直接执行的顺序，并说明哪些任务可以并行、哪些必须等待其他人确认。为了测试长问题在气泡中的换行、图片预览占位和滚动，这一段会比平时写得更长一些。',
                'Demo question: Turn today’s full schedule, meetings, to-dos, and dependencies into a directly executable order, and call out what can run in parallel and what must wait for another person. This paragraph is deliberately longer to check wrapping, the image preview, and scrolling.',
              ));
              state('streaming');
              const text = [
                '### 快速问答长文本测试',
                '',
                '这是一个用于验证 **自动滚动** 和底部按钮占位的长回答。回答内容会持续增加，页面应始终把最新进度放在对话框最下面。',
                '',
                '#### 第一部分：滚动行为',
                '',
                '当内容超过对话框高度时，回答区域应该自动滚动到底部。这样用户不需要手动拖动，也能一直看到最新的流式输出。为了模拟真实的长回答，这里继续补充一段较长的说明文字，确保内容高度明显超过卡片可视区域。',
                '',
                '#### 第二部分：按钮占位',
                '',
                '回答结束后，底部的「继续追问」和「新会话」按钮会重新出现。它们位于聊天卡片的正常布局中，不覆盖最后一段回答；如果内容较长，滚动到底部时最后一行应该完整显示在按钮上方。',
                '',
                '| 项目 | 状态 |',
                '| --- | --- |',
                '| 自动滚动 | 已启用 |',
                '| 按钮占位 | 已预留 |',
                '| Markdown | 已渲染 |',
                '',
                '1. 思考中只显示状态',
                '2. 回答时持续更新',
                '3. 结束后显示两个按钮',
                '',
                '> 这里是一段引用块，用来检查长回答在滚动容器中的排版。',
                '',
                '    const ready = true; // 缩进代码块',
                '',
                '#### 第三部分：结尾',
                '',
                '最后再补充一段较长的文字，确保自动滚动确实发生在对话框内部，而不是整个页面。滚动到底部后，底部按钮应该保持可见，且最后一段文字不会被按钮遮挡。',
                '',
                '更多说明见 [示例链接](https://example.com)。',
              ].join(String.fromCharCode(10));
              let index = 0;
              const timer = setInterval(() => {
                if (index >= text.length) {
                  clearInterval(timer);
                  state('done');
                  return;
                }
                push({ type: 'quickqa-delta', text: text.slice(index, index + 6), sessionId });
                index += 6;
              }, 20);
            } else if (quickDemo === 'result') {
              state('thinking', copy('请把今天的安排整理成一个简短的执行顺序。', 'Turn today’s schedule into a short execution order.'));
              state('streaming');
              const text = [
                copy('### 今日执行顺序', '### Today’s execution order'),
                '',
                copy('1. **18:30 产品评审会**：提前 10 分钟整理演示材料。', '1. **18:30 Product review**: prepare the demo 10 minutes early.'),
                copy('2. **19:30 设计交接**：确认组件清单与间距规范。', '2. **19:30 Design handoff**: confirm the component list and spacing spec.'),
                copy('3. **21:00 收尾**：整理待办，安排明天优先级。', '3. **21:00 Wrap-up**: tidy the to-do list and set tomorrow’s priorities.'),
                '',
                copy('先完成评审材料，再处理设计交接；其余任务可以顺延到明天。', 'Finish the review material first, then the design handoff; the rest can move to tomorrow.'),
              ].join(String.fromCharCode(10));
              let index = 0;
              const timer = setInterval(() => {
                if (index >= text.length) {
                  clearInterval(timer);
                  state('done');
                  return;
                }
                push({ type: 'quickqa-delta', text: text.slice(index, index + 2), sessionId });
                index += 2;
              }, 20);
            } else if (quickDemo === 'second') {
              const stream = (value, after) => {
                state('streaming');
                let cursor = 0;
                const timer = setInterval(() => {
                  if (cursor >= value.length) {
                    clearInterval(timer);
                    state('done');
                    after?.();
                    return;
                  }
                  push({ type: 'quickqa-delta', text: value.slice(cursor, cursor + 2), sessionId });
                  cursor += 2;
                }, 26);
              };
              state('thinking', '第一轮问题：总结今天的安排。');
              stream('第一轮回答：这是快速问答的第一轮结果。', () => {
                setTimeout(() => {
                  state('thinking', '第二轮问题：再补充明天的计划。');
                  setTimeout(() => stream('第二轮回答：这是追加询问后的第二轮结果。'), 900);
                }, 900);
              });
            } else if (quickDemo === 'question') {
              state('thinking', '要使用哪种模式继续？');
              setTimeout(() => push({
                type: 'quickqa-pending',
                sessionId,
                kind: 'question',
                question: '要使用哪种模式继续？',
                header: '运行模式',
                detail: '',
                requestId: 'quick-call-1',
                answerable: true,
                count: 1,
                pushEnabled: true,
                questions: [{
                  id: 'mode',
                  question: '选择运行模式',
                  header: '运行模式',
                  options: [
                    { label: '快速（推荐）', description: '优先完成当前请求' },
                    { label: '稳定', description: '先补齐测试' },
                  ],
                  multiSelect: false,
                }],
              }), 600);
            } else if (quickDemo === 'approval') {
              state('thinking', '请允许读取项目文件。');
              setTimeout(() => push({
                type: 'quickqa-pending',
                sessionId,
                kind: 'approval',
                question: '需要允许读取项目文件',
                header: '文件读取',
                detail: '',
                requestId: 'quick-call-2',
                answerable: false,
                count: 1,
                pushEnabled: true,
                questions: [],
              }), 600);
            }
          }, 700);
        }
        if (wantSheet) {
          setTimeout(() => {
            const state = window.__DSH_REMOTE__;
            if (state) state.answerSessionId = 's-question';
          }, 700);
        }
      }, 40);
    }
    addEventListener(type, fn) {
      (this._listeners[type] ||= []).push(fn);
    }
    removeEventListener(type, fn) {
      this._listeners[type] = (this._listeners[type] || []).filter((item) => item !== fn);
    }
    send() {}
    close() {
      this.readyState = 3;
      this._emit('close', {});
    }
    _emit(type, event) {
      for (const fn of this._listeners[type] || []) fn(event);
    }
  }
  window.WebSocket = MockSocket;
})();
"""
    ).replace("__MESSAGES__", json.dumps(messages, ensure_ascii=False)).replace("__LOCALE__", json.dumps(locale, ensure_ascii=False))


def cover_svg() -> str:
    dots = []
    for index in range(120):
        angle = (index * 2.399963) % (math.pi * 2)
        radius = (index * 37) % 390 + 12
        x = 450 + math.cos(angle) * radius
        y = 450 + math.sin(angle) * radius
        opacity = 0.10 + ((index * 7) % 20) / 100
        dots.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{(index % 3) + 0.4:.1f}" fill="#dce8ff" opacity="{opacity:.2f}"/>')
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 900">
  <defs>
    <linearGradient id="base" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b1730"/>
      <stop offset="0.52" stop-color="#17306b"/>
      <stop offset="1" stop-color="#0b2f63"/>
    </linearGradient>
    <radialGradient id="glow" cx="30%" cy="26%" r="72%">
      <stop offset="0" stop-color="#819dff" stop-opacity="0.64"/>
      <stop offset="0.56" stop-color="#2f5ecb" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#071426" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="38"/></filter>
  </defs>
  <rect width="900" height="900" fill="url(#base)"/>
  <circle cx="280" cy="220" r="330" fill="url(#glow)" filter="url(#soft)"/>
  <circle cx="770" cy="760" r="230" fill="#3d77ff" opacity="0.12" filter="url(#soft)"/>
  {''.join(dots)}
</svg>
"""


def freeze_script() -> str:
    fixed = int(time.time() * 1000) + 5000
    return f"""<script>/* FIXED_CLOCK */
(() => {{
  const RealDate = Date;
  const fixed = {fixed};
  setTimeout(() => {{
    class FixedDate extends RealDate {{
      constructor(...args) {{ if (args.length) super(...args); else super(fixed); }}
      static now() {{ return fixed; }}
    }}
    FixedDate.parse = RealDate.parse;
    FixedDate.UTC = RealDate.UTC;
    window.Date = FixedDate;
  }}, 1500);
}})();
</script>"""


def prepare(
    web_dir: Path,
    out_dir: Path,
    locale: str = "zh",
    timer: str = "pomodoro",
    theme: str = "dark",
    freeze_clock: bool = False,
) -> None:
    if not (web_dir / "index.html").is_file():
        raise SystemExit(f"missing built web page: {web_dir / 'index.html'}")
    if out_dir.exists():
        shutil.rmtree(out_dir)
    shutil.copytree(web_dir, out_dir)
    index = (out_dir / "index.html").read_text(encoding="utf-8")
    injection = (
        "<script>\n"
        + mock_socket_script(demo_payloads(locale, timer, theme), locale)
        + "\n</script>\n"
        + '<img src="/slow.png" alt="" aria-hidden="true" style="position:fixed;width:1px;height:1px;opacity:0;pointer-events:none">\n'
    )
    if freeze_clock:
        injection += freeze_script() + "\n"
    if "</head>" not in index:
        raise SystemExit("index.html has no </head>")
    index = index.replace("</head>", injection + "</head>", 1)
    (out_dir / "index.html").write_text(index, encoding="utf-8")
    (out_dir / "mock-cover.svg").write_text(cover_svg(), encoding="utf-8")


class PreviewHandler(http.server.SimpleHTTPRequestHandler):
    png = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000d49444154789c6360000000020001e221bc330000000049454e44ae426082"
    )

    def do_GET(self) -> None:
        if self.path.split("?", 1)[0] == "/slow.png":
            time.sleep(1.3)
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(self.png)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(self.png)
            return
        super().do_GET()

    def log_message(self, fmt: str, *args: object) -> None:
        return


class PreviewServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--web", default=str(ROOT / "web"), help="built Vite output directory")
    parser.add_argument("--out", default=str(ROOT / ".mock-web"), help="prepared preview directory")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--locale", choices=["zh", "en"], default="zh", help="demo console language")
    parser.add_argument("--timer", choices=["pomodoro", "countdown"], default="pomodoro", help="timer card shown on the home page")
    parser.add_argument("--theme", choices=["dark", "light"], default="dark", help="demo console theme")
    parser.add_argument("--freeze-clock", action="store_true", help="freeze the rendered clock so dark/light captures align")
    args = parser.parse_args()

    web_dir = Path(args.web).resolve()
    out_dir = Path(args.out).resolve()
    prepare(web_dir, out_dir, args.locale, args.timer, args.theme, args.freeze_clock)
    handler = functools.partial(PreviewHandler, directory=str(out_dir))
    with PreviewServer((args.host, args.port), handler) as server:
        print(f"mock preview: http://{args.host}:{args.port}/?page=home", flush=True)
        print(f"locale:      {args.locale}", flush=True)
        print(f"theme:       {args.theme}", flush=True)
        print(f"timer:       {args.timer}", flush=True)
        print("question:    ?page=home&sheet=1", flush=True)
        print("quickqa:     ?page=quickqa&quickqa=done&scroll=top", flush=True)
        print("attach:      ?page=quickqa&image=1", flush=True)
        print("companion:   ?page=quickqa&companion=1", flush=True)
        print("recording:   ?page=quickqa&capturing=1", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
