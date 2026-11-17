/**
 * A running agent client: one browser that stays logged in to Foundry as one
 * user, and the control channel through which the command line drives it.
 *
 * The browser is the installed Google Chrome or Microsoft Edge with its own
 * profile folder, so it uses the graphics card, never touches the person's
 * everyday browser profile, and keeps Foundry's per-device settings between
 * starts.
 *
 * Logging in: the password comes from the secret store of the operating
 * system right before each login and goes to POST /join, the same request
 * Foundry's own login form sends. It is never typed into the page, so it is
 * on no screenshot, and it is never written to the log. Foundry keeps
 * sessions in memory only; after a restart of Foundry the page ends up on the
 * login screen and the client logs in again by itself.
 */
import { appendFileSync, mkdirSync, statSync, truncateSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { MODULE_ID } from '../../common/constants.js';
import {
  serveControl,
  type ClientStatus,
  type ControlRequest,
  type ControlResponse,
} from './control.js';
import {
  evaluationCode,
  isSoftwareRenderer,
  PAUSE_MS,
  placeOf,
  retryDelayMs,
  STATE_HINT,
  type ClientState,
} from './page.js';
import { clientSettings, type Profile } from './profile.js';
import type { SecretStore } from './secret-store.js';

const CARE_MS = 20_000;
const SOCKET_PATIENCE_MS = 120_000;
const WORLD_LOAD_MS = 180_000;
/** What opens by itself after a load counts as start-up noise this long. */
const FRESH_MS = 120_000;
const JS_TIMEOUT_MS = 60_000;
const RESULT_LIMIT = 512 * 1024;
const LOG_LIMIT_BYTES = 2 * 1024 * 1024;

interface PageInfo {
  address: string;
  ready: boolean;
  userId: string | null;
  userName: string | null;
  role: number | null;
  world: string | null;
  socket: boolean;
  canvas: boolean;
  bridge: { state: string; role?: string } | null;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: no answer within ${ms / 1000} s`)), ms);
  });
  try {
    return await Promise.race([promise, limit]);
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export interface RunnerOptions {
  profile: Profile;
  dir: string;
  visible: boolean;
  store: SecretStore;
}

export class AgentClientRunner {
  private state: ClientState = 'starting';
  private since = new Date();
  private message: string | undefined;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private browserName: string | undefined;
  private failures = 0;
  private nextTry = 0;
  private socketLostSince: number | null = null;
  private loadingSince: number | null = null;
  private readySince: number | null = null;
  private renderer: string | null = null;
  private lastInfo: PageInfo | null = null;
  private careRunning: Promise<void> | null = null;
  private stopping = false;
  private timer: NodeJS.Timeout | null = null;
  private closeControl: (() => void) | null = null;
  private readonly lines: string[] = [];
  private readonly logFile: string;
  private readonly origin: string;

  constructor(private readonly options: RunnerOptions) {
    this.logFile = join(options.dir, 'client.log');
    this.origin = new URL(options.profile.url).origin;
  }

  // ------------------------------------------------------------ lifecycle

  async run(): Promise<void> {
    mkdirSync(this.options.dir, { recursive: true });
    try {
      if (statSync(this.logFile).size > LOG_LIMIT_BYTES) truncateSync(this.logFile, 0);
    } catch {
      // No log yet.
    }
    const control = await serveControl(this.options.dir, this.options.profile.name, request =>
      this.handle(request)
    );
    this.closeControl = control.close;
    const { profile } = this.options;
    this.log(
      `Agent client "${profile.name}" for user ${profile.userId} on ${profile.url}, ` +
        `canvas ${profile.canvas}, bridge ${profile.bridge}, ${this.options.visible ? 'visible' : 'without a window'}`
    );
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      process.on(signal, () => void this.shutdown(`signal ${signal}`));
    }
    await this.care();
    this.timer = setInterval(() => void this.care(), CARE_MS);
  }

  async shutdown(reason: string): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.log(`Stopping (${reason})`);
    if (this.timer) clearInterval(this.timer);
    await this.closeBrowser();
    this.closeControl?.();
    process.exit(0);
  }

  private log(text: string): void {
    const line = `${new Date().toISOString()} ${text}`;
    this.lines.push(line);
    if (this.lines.length > 300) this.lines.shift();
    try {
      appendFileSync(this.logFile, `${line}\n`);
    } catch {
      // The log is a help, not a reason to stop.
    }
  }

  private set(state: ClientState, message?: string): void {
    const pause = PAUSE_MS[state];
    if (pause) this.nextTry = Date.now() + pause;
    if (state === this.state && message === this.message) return;
    this.state = state;
    this.message = message;
    this.since = new Date();
    this.log(`State ${state}${message ? `: ${message}` : ''}`);
  }

  // ------------------------------------------------------------ browser

  private async launch(): Promise<Page> {
    const { profile, visible } = this.options;
    const channels =
      profile.browser === 'auto' ? (['chrome', 'msedge'] as const) : [profile.browser];
    let lastError: unknown;
    for (const channel of channels) {
      try {
        this.context = await chromium.launchPersistentContext(join(this.options.dir, 'browser'), {
          channel,
          headless: !visible,
          viewport: visible ? null : { width: profile.width, height: profile.height },
          args: [`--window-size=${profile.width},${profile.height}`],
        });
        this.browserName = channel === 'chrome' ? 'Google Chrome' : 'Microsoft Edge';
        break;
      } catch (error) {
        lastError = error;
      }
    }
    const context = this.context;
    if (!context) {
      const detail =
        lastError instanceof Error ? lastError.message.split('\n')[0] : String(lastError);
      const tried = channels
        .map(c => (c === 'chrome' ? 'Google Chrome' : 'Microsoft Edge'))
        .join(' or ');
      throw new Error(
        `${tried} could not be started (${detail}). Install it, use --browser msedge on a ` +
          'computer without Chrome, or close the window of this agent client if it is already open.'
      );
    }
    context.on('close', () => {
      if (this.context !== context) return;
      this.context = null;
      this.page = null;
      this.log('Browser closed');
    });
    // The bridge connects the Foundry page to ws://localhost. Chrome asks the
    // person before a public page may reach the local network; without a
    // window, or with nobody watching, that answer is no.
    try {
      await context.grantPermissions(['local-network-access'], { origin: this.origin });
    } catch (error) {
      this.log(
        `Local network access could not be granted: ${(error as Error).message.split('\n')[0]}`
      );
    }
    await context.addInitScript(entries => {
      for (const [key, value] of Object.entries(entries)) {
        try {
          localStorage.setItem(key, value);
        } catch {
          // about:blank and error pages have no localStorage.
        }
      }
    }, clientSettings(profile));
    const page = context.pages()[0] ?? (await context.newPage());
    page.on('crash', () => {
      this.log('The page crashed');
      void this.closeBrowser();
    });
    // A browser dialog would stop the page; with no window nobody would answer it.
    page.on('dialog', dialog => void dialog.dismiss().catch(() => undefined));
    this.page = page;
    this.renderer = null;
    this.log(`Browser started: ${this.browserName}`);
    return page;
  }

  private async closeBrowser(): Promise<void> {
    const context = this.context;
    this.context = null;
    this.page = null;
    this.lastInfo = null;
    this.socketLostSince = null;
    this.loadingSince = null;
    this.readySince = null;
    if (context) await context.close().catch(() => undefined);
  }

  private async readPage(page: Page): Promise<PageInfo> {
    const address = page.url();
    const inner = await withTimeout(
      page.evaluate(moduleId => {
        const g = (globalThis as any).game;
        const status = g?.modules?.get?.(moduleId)?.api?.getStatus?.() ?? null;
        return {
          ready: g?.ready === true,
          userId: (g?.user?.id as string | undefined) ?? null,
          userName: (g?.user?.name as string | undefined) ?? null,
          role: (g?.user?.role as number | undefined) ?? null,
          world: (g?.world?.id as string | undefined) ?? null,
          socket: g?.socket?.connected === true,
          canvas: (globalThis as any).canvas?.ready === true,
          bridge: status
            ? { state: String(status.connectionState), role: status.connectionInfo?.role }
            : null,
        };
      }, MODULE_ID),
      15_000,
      'Reading the page'
    );
    return { address, ...inner };
  }

  private async readRenderer(page: Page): Promise<void> {
    this.renderer = await withTimeout(
      page.evaluate(() => {
        const canvas = (globalThis as any).document.createElement('canvas');
        const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
        if (!gl) return null;
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return name;
      }),
      10_000,
      'Reading the renderer'
    ).catch(() => null);
    if (isSoftwareRenderer(this.renderer))
      this.log(
        `No graphics card in use (${this.renderer}): maps will be slow and use a full CPU core`
      );
  }

  /**
   * Closes what opens by itself after a load and would cover every screenshot,
   * the way "Later" does (no setting is changed):
   * - welcome windows of modules that mark them (`.ninjo-willkommen`) and the
   *   update notice of this module, every time;
   * - right after a load only: Foundry's own user configuration, which it
   *   opens for a player without a character, and its warning about missing
   *   hardware acceleration. Opened later, an agent wanted them.
   */
  private async closeNotices(page: Page, fresh: boolean): Promise<void> {
    const closed = await withTimeout(
      page.evaluate(async fresh => {
        const g = globalThis as any;
        const apps = g.foundry?.applications?.instances;
        if (!apps) return 0;
        let count = 0;
        for (const app of [...apps.values()]) {
          const element = app?.element;
          if (!app?.rendered || !element) continue;
          const ownConfig =
            fresh &&
            app.constructor?.name === 'UserConfig' &&
            app.document?.id === g.game?.user?.id;
          if (
            element.querySelector('.ninjo-willkommen') ||
            element.classList.contains('mcp-update-notice') ||
            ownConfig
          ) {
            await app.close();
            count += 1;
          }
        }
        if (fresh) {
          const warning = g.game?.i18n?.localize?.('ERROR.NoHardwareAcceleration');
          for (const note of (globalThis as any).document.querySelectorAll(
            '#notifications .notification'
          )) {
            if (warning && note.innerText.trim().startsWith(String(warning).slice(0, 40))) {
              note.remove();
              count += 1;
            }
          }
        }
        return count;
      }, fresh),
      15_000,
      'Closing start-up windows'
    ).catch(() => 0);
    if (closed) this.log(`Closed ${closed} start-up window(s)`);
  }

  // ------------------------------------------------------------ logging in

  private async login(page: Page): Promise<void> {
    const { profile, store } = this.options;
    this.set('logging-in');
    await page.goto(`${profile.url}/game`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (placeOf(page.url()) === 'game') {
      this.loadingSince = Date.now();
      this.readySince = null;
      return;
    }
    if (placeOf(page.url()) !== 'join') {
      this.set('no-world', `Foundry shows ${new URL(page.url()).pathname}`);
      return;
    }
    await page.waitForFunction(() => ((globalThis as any).game?.users?.size ?? 0) > 0, null, {
      timeout: 60_000,
    });
    const user = await page.evaluate(id => {
      const found = (globalThis as any).game.users.get(id);
      return found ? { name: String(found.name), active: found.active === true } : null;
    }, profile.userId);
    if (!user) {
      this.set('user-missing', `The world has no user with the id ${profile.userId}`);
      return;
    }
    if (user.active) {
      this.set('in-use', `"${user.name}" is logged in somewhere else`);
      return;
    }

    let password = await store.read();
    if (password === null) {
      this.set('no-password', `No password stored (${store.kind})`);
      return;
    }
    // The same request as Foundry's login form. The request shares its cookies
    // with the page, so the session counts there too. Foundry refuses any POST
    // that does not look same-origin; a browser says so with Sec-Fetch-Site,
    // and behind a reverse proxy Origin alone may not match what Foundry sees.
    const response = await this.context!.request.post(`${profile.url}/join`, {
      data: { userId: profile.userId, password, action: 'join' },
      headers: { 'Sec-Fetch-Site': 'same-origin', Origin: this.origin },
      failOnStatusCode: false,
      timeout: 30_000,
    });
    password = '';
    if (response.status() === 401) {
      const text = (await response.text().catch(() => '')).slice(0, 160);
      this.set('password-rejected', `Foundry rejected the login of "${user.name}" (${text})`);
      return;
    }
    if (!response.ok()) throw new Error(`Login failed: HTTP ${response.status()}`);
    this.log(`Logged in as ${user.name}`);
    await page.goto(`${profile.url}/game`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (placeOf(page.url()) !== 'game')
      throw new Error(`After the login the page shows ${page.url()}`);
    this.loadingSince = Date.now();
    this.readySince = null;
  }

  // ------------------------------------------------------------ care

  /** One round; a caller during a running round waits for that one. */
  private care(): Promise<void> {
    this.careRunning ??= this.careRound().finally(() => {
      this.careRunning = null;
    });
    return this.careRunning;
  }

  private async careRound(): Promise<void> {
    if (this.stopping) return;
    try {
      if (Date.now() < this.nextTry) {
        // While waiting for a person, nobody needs the browser.
        if (this.context && PAUSE_MS[this.state]) await this.closeBrowser();
        return;
      }
      if (this.state !== 'ready' && !(await this.options.store.has())) {
        if (this.context) await this.closeBrowser();
        this.set('no-password', `No password stored (${this.options.store.kind})`);
        return;
      }
      if (!this.context || !this.page) {
        this.set('starting');
        await this.launch();
      }
      const page = this.page!;
      let info: PageInfo;
      try {
        info = await this.readPage(page);
      } catch (error) {
        // While the world loads the page is often busy for seconds.
        if (this.loadingSince && Date.now() - this.loadingSince < WORLD_LOAD_MS) {
          this.set('starting', 'The world is loading');
          return;
        }
        throw error;
      }
      this.lastInfo = info;
      const place = placeOf(info.address);
      const rightUser = info.userId === this.options.profile.userId;

      if (place === 'game' && info.ready && rightUser) {
        this.loadingSince = null;
        if (info.socket) {
          this.socketLostSince = null;
        } else {
          this.socketLostSince ??= Date.now();
          if (Date.now() - this.socketLostSince > SOCKET_PATIENCE_MS) {
            // Foundry restarted or the network was gone: a reload shows the
            // login screen if the session is lost, and the next round logs in.
            this.log('No connection to Foundry for two minutes, reloading');
            this.socketLostSince = null;
            await page.goto(`${this.options.profile.url}/game`, {
              waitUntil: 'domcontentloaded',
              timeout: 60_000,
            });
            this.loadingSince = Date.now();
            this.readySince = null;
            return;
          }
        }
        const fresh = this.readySince === null || Date.now() - this.readySince < FRESH_MS;
        await this.closeNotices(page, fresh);
        if (this.readySince === null) {
          this.readySince = Date.now();
          await this.readRenderer(page);
        }
        this.failures = 0;
        this.set('ready', info.socket ? undefined : 'The connection to Foundry is interrupted');
        return;
      }
      if (
        place === 'game' &&
        !info.ready &&
        this.loadingSince &&
        Date.now() - this.loadingSince < WORLD_LOAD_MS
      ) {
        this.set('starting', 'The world is loading');
        return;
      }
      if (place === 'game' && info.ready && !rightUser) {
        // Someone logged this browser in as another user. Start over cleanly.
        this.log(
          `Logged in as ${info.userName} instead of ${this.options.profile.userId}, logging out`
        );
        await this.context!.clearCookies();
      }
      await this.login(page);
    } catch (error) {
      this.failures += 1;
      this.nextTry = Date.now() + retryDelayMs(this.failures);
      this.set('error', error instanceof Error ? error.message.split('\n')[0] : String(error));
      if (this.failures >= 3) await this.closeBrowser();
    }
  }

  /**
   * Starts if needed and waits until the client is ready or it is clear it
   * will not be. A command means "try now", except after a rejected password
   * or while the user is logged in elsewhere: an agent repeating a command must
   * not turn into a stream of logins.
   */
  private async ensureReady(timeoutMs = WORLD_LOAD_MS + 60_000): Promise<string | null> {
    await this.care();
    if (this.state !== 'ready' && this.state !== 'password-rejected' && this.state !== 'in-use') {
      this.nextTry = 0;
    }
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      await this.care();
      if (this.state === 'ready' && this.page) return null;
      if (PAUSE_MS[this.state] || (this.state === 'error' && this.failures >= 3)) {
        return `${this.state}${this.message ? `: ${this.message}` : ''}. ${STATE_HINT[this.state]}`;
      }
      if (this.state === 'error') this.nextTry = 0;
      await sleep(2_000);
    }
    return `Not ready after ${Math.round(timeoutMs / 1000)} s (${this.state})`;
  }

  // ------------------------------------------------------------ commands

  private status(): ClientStatus {
    const { profile } = this.options;
    const report: ClientStatus = {
      name: profile.name,
      url: profile.url,
      userId: profile.userId,
      state: this.state,
      since: this.since.toISOString(),
      hint: STATE_HINT[this.state],
      pid: process.pid,
      visible: this.options.visible,
    };
    if (this.message) report.message = this.message;
    if (this.browserName) report.browser = this.browserName;
    const info = this.lastInfo;
    // Details only when someone is really logged in; on the login page they would mislead.
    if (info && this.context && info.userId && placeOf(info.address) === 'game') {
      if (info.userName) report.loggedInAs = info.userName;
      if (info.role !== null) report.role = info.role;
      if (info.world) report.world = info.world;
      report.socketConnected = info.socket;
      report.canvas = info.canvas;
      report.bridge = info.bridge;
      report.renderer = this.renderer;
      report.softwareRendering = isSoftwareRenderer(this.renderer);
    }
    return report;
  }

  private async evaluate(code: string): Promise<unknown> {
    const { expression, body } = evaluationCode(code);
    const page = this.page!;
    try {
      return await withTimeout(page.evaluate(expression), JS_TIMEOUT_MS, 'JavaScript');
    } catch (error) {
      if (!(error instanceof Error) || !/SyntaxError/.test(error.message)) throw error;
      return await withTimeout(page.evaluate(body), JS_TIMEOUT_MS, 'JavaScript');
    }
  }

  private async handle(request: ControlRequest): Promise<ControlResponse> {
    if (request.command !== 'status' && request.command !== 'log')
      this.log(`Command ${request.command}`);
    switch (request.command) {
      case 'status':
        return { ok: true, status: this.status() };
      case 'log':
        return { ok: true, lines: [...this.lines] };
      case 'stop':
        setTimeout(() => void this.shutdown('stop command'), 50);
        return { ok: true, status: this.status() };
      case 'reload': {
        if (this.page) {
          await this.page
            .reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
            .catch(() => undefined);
          this.loadingSince = Date.now();
          this.readySince = null;
        }
        const problem = await this.ensureReady();
        return problem
          ? { ok: false, error: problem, status: this.status() }
          : { ok: true, status: this.status() };
      }
      case 'js': {
        if (typeof request.code !== 'string' || !request.code.trim())
          return { ok: false, error: 'No code given' };
        const problem = await this.ensureReady();
        if (problem) return { ok: false, error: problem, status: this.status() };
        try {
          const result = await this.evaluate(request.code);
          const size = JSON.stringify(result)?.length ?? 0;
          if (size > RESULT_LIMIT)
            return {
              ok: false,
              error: `The result is too large (${Math.round(size / 1024)} KB); ask for less`,
            };
          return { ok: true, result };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      }
      case 'screenshot': {
        const problem = await this.ensureReady();
        if (problem) return { ok: false, error: problem, status: this.status() };
        // Only in the game: the login screen is never photographed.
        if (placeOf(this.page!.url()) !== 'game')
          return { ok: false, error: 'The page is not in the game' };
        const png = await withTimeout(this.page!.screenshot({ type: 'png' }), 30_000, 'Screenshot');
        return { ok: true, png: png.toString('base64') };
      }
      default:
        return { ok: false, error: `Unknown command ${String(request.command)}` };
    }
  }
}
