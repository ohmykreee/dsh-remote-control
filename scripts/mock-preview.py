#!/usr/bin/env python3
"""Serve the built web console with deterministic demo data for screenshots.

This is development tooling, not part of the plugin runtime. It copies the
Vite output to a temporary directory, injects a fake WebSocket that emits the
same envelopes as the Host, and serves the result with a short artificial load
delay so a headless/real-display screenshot includes the rendered data.

Usage (run after `pnpm build:web`):

    python3 scripts/mock-preview.py --web web --port 4173
    # http://127.0.0.1:4173/?page=music
    # http://127.0.0.1:4173/?page=home&sheet=1   (opens the question dialog)

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


def demo_payloads(locale: str = "zh") -> list[dict]:
    settings = {
        "theme": "dark",
        "locale": locale,
        "temperatureUnit": "celsius",
        "pushQuestions": True,
        "navPosition": "left",
        "pageOrder": ["home", "sessions", "music", "performance"],
        "pageEnabled": {"home": True, "sessions": True, "music": True, "performance": True},
        "pomodoro": {
            "enabled": True,
            "focusMinutes": 25,
            "breakMinutes": 5,
            "soundPath": "",
            "loopAlarm": False,
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

    return [
        {"type": "welcome", "settings": settings},
        {"type": "overview", "data": overview},
        {"type": "media", "data": media},
        {"type": "performance", "data": performance},
        {"type": "clients", "data": []},
    ]


def mock_socket_script(messages: list[dict]) -> str:
    return (
        """
(function () {
  const params = new URLSearchParams(location.search);
  const wantSheet = params.get('sheet') === '1';
  const MESSAGES = __MESSAGES__;
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
    ).replace("__MESSAGES__", json.dumps(messages, ensure_ascii=False))


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


def prepare(web_dir: Path, out_dir: Path, locale: str = "zh") -> None:
    if not (web_dir / "index.html").is_file():
        raise SystemExit(f"missing built web page: {web_dir / 'index.html'}")
    if out_dir.exists():
        shutil.rmtree(out_dir)
    shutil.copytree(web_dir, out_dir)
    index = (out_dir / "index.html").read_text(encoding="utf-8")
    injection = (
        "<script>\n"
        + mock_socket_script(demo_payloads(locale))
        + "\n</script>\n"
        + '<img src="/slow.png" alt="" aria-hidden="true" style="position:fixed;width:1px;height:1px;opacity:0;pointer-events:none">\n'
    )
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
    args = parser.parse_args()

    web_dir = Path(args.web).resolve()
    out_dir = Path(args.out).resolve()
    prepare(web_dir, out_dir, args.locale)
    handler = functools.partial(PreviewHandler, directory=str(out_dir))
    with PreviewServer((args.host, args.port), handler) as server:
        print(f"mock preview: http://{args.host}:{args.port}/?page=home", flush=True)
        print("question:    ?page=home&sheet=1", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
