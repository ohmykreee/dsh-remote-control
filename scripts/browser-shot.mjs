#!/usr/bin/env node
/**
 * Dev-only screenshot helper for the phone console.
 *
 * Starts the deterministic mock preview (`scripts/mock-preview.py`), opens it
 * in a locally installed Edge/Chrome through `playwright-core`, and writes a
 * PNG. No Playwright browser download is required: the script uses the system
 * browser, and `DSH_BROWSER_PATH` can point at a custom executable.
 *
 * Examples:
 *   node scripts/browser-shot.mjs --timer countdown
 *   node scripts/browser-shot.mjs --timer countdown --locale en --out .mock-web/countdown-en.png
 *   node scripts/browser-shot.mjs --timer countdown --click '.countdown-main-row button' --settle 2500
 *   node scripts/browser-shot.mjs --url http://127.0.0.1:4173/?page=home --out shot.png
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = {
    timer: 'pomodoro',
    locale: 'zh',
    page: 'home',
    width: 1280,
    height: 800,
    wait: 900,
    settle: 0,
    click: '',
    out: '',
    url: '',
    port: 0,
    web: path.join(ROOT, 'web'),
    browser: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const next = (label) => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${label} needs a value`);
      index += 1;
      return value;
    };
    switch (name) {
      case '--timer': args.timer = next(name); break;
      case '--locale': args.locale = next(name); break;
      case '--page': args.page = next(name); break;
      case '--width': args.width = Number(next(name)); break;
      case '--height': args.height = Number(next(name)); break;
      case '--wait': args.wait = Number(next(name)); break;
      case '--settle': args.settle = Number(next(name)); break;
      case '--click': args.click = next(name); break;
      case '--out': args.out = next(name); break;
      case '--url': args.url = next(name); break;
      case '--port': args.port = Number(next(name)); break;
      case '--web': args.web = path.resolve(ROOT, next(name)); break;
      case '--browser': args.browser = next(name); break;
      case '--help': case '-h':
        console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 17).join('\n'));
        process.exit(0);
        break;
      default:
        throw new Error(`unknown option: ${name}`);
    }
  }
  if (!['pomodoro', 'countdown'].includes(args.timer)) throw new Error(`unknown timer: ${args.timer}`);
  if (!['zh', 'en'].includes(args.locale)) throw new Error(`unknown locale: ${args.locale}`);
  if (!args.out) {
    args.out = path.join(ROOT, '.mock-web', `${args.page}-${args.timer}-${args.locale}.png`);
  } else {
    args.out = path.resolve(ROOT, args.out);
  }
  return args;
}

/** First existing browser executable; Playwright channels are the fallback. */
function browserExecutable(explicit) {
  const candidates = [
    explicit,
    process.env.DSH_BROWSER_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function waitForHttp(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) resolve();
        else retry();
      });
      request.on('error', retry);
      request.setTimeout(1500, () => {
        request.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() > deadline) {
        reject(new Error(`mock preview did not start: ${url}`));
        return;
      }
      setTimeout(attempt, 200);
    };
    attempt();
  });
}

async function launchBrowser(explicit) {
  const executablePath = browserExecutable(explicit);
  if (executablePath) {
    return chromium.launch({ headless: true, executablePath });
  }
  const channels = process.platform === 'win32' ? ['msedge', 'chrome'] : ['chrome', 'chromium', 'msedge'];
  let lastError;
  for (const channel of channels) {
    try {
      return await chromium.launch({ headless: true, channel });
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `no local Chrome/Edge found; set DSH_BROWSER_PATH (last error: ${lastError instanceof Error ? lastError.message : lastError})`,
  );
}

function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  try {
    child.kill('SIGTERM');
  } catch {
    /* already gone */
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const python = process.env.PYTHON || process.env.PYTHON3 || 'python';
  let server;
  let browser;
  let url = args.url;
  try {
    if (!url) {
      const port = args.port || await freePort();
      const previewDir = path.join(ROOT, '.mock-web', `shot-${port}`);
      server = spawn(python, [
        path.join(ROOT, 'scripts', 'mock-preview.py'),
        '--web', args.web,
        '--out', previewDir,
        '--port', String(port),
        '--locale', args.locale,
        '--timer', args.timer,
      ], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
      url = `http://127.0.0.1:${port}/?page=${encodeURIComponent(args.page)}`;
      await waitForHttp(url);
    }

    browser = await launchBrowser(args.browser);
    const context = await browser.newContext({
      viewport: { width: args.width, height: args.height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(args.wait);
    if (args.click) {
      await page.locator(args.click).first().click();
      if (args.settle > 0) await page.waitForTimeout(args.settle);
    }
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    await page.screenshot({ path: args.out });
    console.log(args.out);
  } finally {
    if (browser) await browser.close().catch(() => {});
    stopProcess(server);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
