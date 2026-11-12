/**
 * Persistent `dsh-probe daemon` client.
 *
 * Starting the native probe for every poll costs process creation plus a full
 * platform sampler warm-up (sysinfo's CPU window, PDH query setup, D-Bus
 * connect, WinRT initialization). This client keeps one daemon process alive
 * and multiplexes requests over newline-delimited JSON on stdin/stdout.
 *
 * The daemon is demand-driven: it only samples when a request arrives, so an
 * idle console costs one sleeping process and no periodic wake-ups. It exits
 * after `IDLE_TIMEOUT_MS` without requests, and the next request starts a fresh
 * one. If the binary predates daemon support, `probe.ts` falls back to one-shot
 * invocations for a while instead of failing the feature.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import type { JsonRecord } from './types.js';
import { isRecord } from './types.js';

/** Must match `daemon::PROTOCOL_VERSION` in the Rust probe. */
export const DAEMON_PROTOCOL_VERSION = 1;

const READY_TIMEOUT_MS = 10_000;
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
const MAX_STDERR = 4_000;

/** The daemon could not be started; the caller may retry with one-shot mode. */
export class ProbeDaemonStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProbeDaemonStartError';
  }
}

interface PendingRequest {
  resolve: (value: JsonRecord) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface ReadyGate {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

function idleTimeoutMs(): number {
  const raw = Number(process.env.DSH_RC_PROBE_DAEMON_IDLE_MS);
  if (!Number.isFinite(raw) || raw < 5_000) return DEFAULT_IDLE_TIMEOUT_MS;
  return Math.min(raw, 30 * 60_000);
}

export class ProbeDaemonClient {
  private readonly binary: string;
  private readonly env: NodeJS.ProcessEnv;
  private child: ChildProcessWithoutNullStreams | null = null;
  private reader: Interface | null = null;
  private readyGate: ReadyGate | null = null;
  private ready = false;
  private starting: Promise<void> | null = null;
  private pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private stderr = '';
  private idleTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(binary: string, env: NodeJS.ProcessEnv = process.env) {
    this.binary = binary;
    this.env = env;
  }

  isRunning(): boolean {
    return this.ready && this.child !== null;
  }

  /** Run one probe command through the daemon, starting it on demand. */
  async request(argv: string[], timeoutMs: number): Promise<JsonRecord> {
    if (!this.ready || !this.child) await this.ensureStarted();
    const child = this.child;
    if (!child || !this.ready) throw new ProbeDaemonStartError('probe daemon is not running');
    if (child.stdin.destroyed) throw new ProbeDaemonStartError('probe daemon stdin is closed');

    const id = this.nextId++;
    const payload = `${JSON.stringify({ id, argv })}\n`;
    const timeout = Math.max(1_000, Math.min(Number(timeoutMs) || 15_000, 60_000));

    return new Promise<JsonRecord>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.fail(new Error(`dsh-probe daemon ${argv.join(' ')} timed out after ${timeout} ms`));
      }, timeout);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.armIdle();

      child.stdin.write(payload, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        clearTimeout(pending.timer);
        pending.reject(error);
      });
    });
  }

  /** Stop the daemon and reject anything still in flight. */
  shutdown(): void {
    this.stopped = true;
    this.clearIdle();
    const error = new Error('probe daemon shut down');
    this.rejectAll(error);
    const gate = this.readyGate;
    this.readyGate = null;
    if (gate) {
      clearTimeout(gate.timer);
      gate.reject(new ProbeDaemonStartError(error.message));
    }
    const child = this.child;
    this.child = null;
    this.ready = false;
    this.reader?.close();
    this.reader = null;
    if (child) {
      try {
        child.stdin.end();
      } catch {
        /* already closed */
      }
      try {
        child.kill();
      } catch {
        /* already exited */
      }
    }
  }

  /** Synchronous best-effort kill for a process-exit hook. */
  kill(): void {
    const child = this.child;
    this.child = null;
    this.ready = false;
    if (!child) return;
    try {
      child.kill();
    } catch {
      /* already exited */
    }
  }

  private ensureStarted(): Promise<void> {
    if (this.ready && this.child) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = this.start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private start(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(this.binary, ['daemon'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          env: this.env,
        });
      } catch (error) {
        reject(new ProbeDaemonStartError(`failed to start dsh-probe daemon: ${String(error)}`));
        return;
      }

      this.child = child;
      this.ready = false;
      this.stderr = '';
      this.stopped = false;

      const timer = setTimeout(() => {
        this.readyGate = null;
        this.stopChild(child);
        reject(new ProbeDaemonStartError(`dsh-probe daemon did not become ready within ${READY_TIMEOUT_MS} ms`));
      }, READY_TIMEOUT_MS);
      timer.unref?.();
      this.readyGate = { resolve, reject, timer };

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        this.stderr = (this.stderr + chunk).slice(-MAX_STDERR);
      });
      child.once('error', (error) => {
        if (this.child !== child) return;
        this.failStart(child, new ProbeDaemonStartError(`failed to start dsh-probe daemon: ${error.message}`));
      });
      child.once('exit', (code, signal) => {
        this.handleExit(child, code, signal);
      });

      const reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
      this.reader = reader;
      reader.on('line', (line) => {
        this.handleLine(line);
      });
      reader.on('close', () => {
        /* the exit handler owns cleanup */
      });
    });
  }

  private handleLine(line: string): void {
    const text = line.trim();
    if (!text) return;
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (!isRecord(message)) return;

    if (message.event === 'ready') {
      if (this.ready) return;
      const protocol = Number(message.protocol);
      if (protocol !== DAEMON_PROTOCOL_VERSION) {
        this.failStart(
          this.child,
          new ProbeDaemonStartError(
            `dsh-probe daemon protocol ${String(message.protocol)} is not supported (expected ${DAEMON_PROTOCOL_VERSION})`,
          ),
        );
        return;
      }
      this.ready = true;
      const gate = this.readyGate;
      this.readyGate = null;
      if (gate) {
        clearTimeout(gate.timer);
        gate.resolve();
      }
      this.armIdle();
      return;
    }

    const id = typeof message.id === 'number' ? message.id : null;
    if (id === null) return;
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    this.armIdle();

    if (message.ok !== true) {
      pending.reject(new Error(typeof message.error === 'string' ? message.error : 'dsh-probe daemon request failed'));
      return;
    }
    if (!isRecord(message.result)) {
      pending.reject(new Error('dsh-probe daemon returned no result payload'));
      return;
    }
    pending.resolve(message.result);
  }

  private handleExit(
    child: ChildProcessWithoutNullStreams,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.child !== child) return;
    this.child = null;
    this.ready = false;
    this.reader?.close();
    this.reader = null;
    this.clearIdle();

    const detail = [
      code === null ? '' : `code ${code}`,
      signal ? `signal ${signal}` : '',
      this.stderr.trim(),
    ]
      .filter(Boolean)
      .join(', ');
    const message = `dsh-probe daemon exited${detail ? ` (${detail})` : ''}`;

    const gate = this.readyGate;
    this.readyGate = null;
    if (gate) {
      clearTimeout(gate.timer);
      gate.reject(new ProbeDaemonStartError(message));
    }
    this.rejectAll(new Error(message));
  }

  private failStart(child: ChildProcessWithoutNullStreams | null, error: ProbeDaemonStartError): void {
    const gate = this.readyGate;
    this.readyGate = null;
    if (gate) {
      clearTimeout(gate.timer);
      gate.reject(error);
    }
    this.rejectAll(error);
    if (child) this.stopChild(child);
  }

  private fail(error: Error): void {
    this.rejectAll(error);
    const child = this.child;
    this.child = null;
    this.ready = false;
    if (child) this.stopChild(child);
  }

  private stopChild(child: ChildProcessWithoutNullStreams): void {
    if (this.child === child) {
      this.child = null;
      this.ready = false;
    }
    this.reader?.close();
    this.reader = null;
    try {
      child.stdin.end();
    } catch {
      /* already closed */
    }
    try {
      child.kill();
    } catch {
      /* already exited */
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private armIdle(): void {
    this.clearIdle();
    if (this.stopped || !this.ready) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.pending.size > 0) {
        this.armIdle();
        return;
      }
      this.shutdown();
    }, idleTimeoutMs());
    this.idleTimer.unref?.();
  }

  private clearIdle(): void {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}
