/**
 * What the agent client knows about Foundry's pages and its own states,
 * without a browser: everything here is plain functions, so it is tested
 * without starting one.
 */

/** Where the page of the client stands, by its path. */
export type Place = 'game' | 'join' | 'no-world' | 'other';

export function placeOf(address: string): Place {
  let path: string;
  try {
    path = new URL(address).pathname.replace(/\/+$/, '');
  } catch {
    return 'other';
  }
  if (path.endsWith('/game')) return 'game';
  if (path.endsWith('/join')) return 'join';
  if (/\/(setup|auth|license|players|update)$/.test(path)) return 'no-world';
  return 'other';
}

/**
 * The states of a client. The ones after `ready` wait for a person and say
 * what to do; the client tries again on its own after a pause, so a fixed
 * cause (a new password, the world started) is picked up without a restart.
 */
export type ClientState =
  | 'starting'
  | 'logging-in'
  | 'ready'
  | 'no-password'
  | 'password-rejected'
  | 'in-use'
  | 'user-missing'
  | 'no-world'
  | 'error';

/** How long a waiting state rests before the next try. */
export const PAUSE_MS: Partial<Record<ClientState, number>> = {
  'no-password': 60_000,
  // Never hammer a login that failed: 15 minutes, so a wrong password does not fill Foundry's log.
  'password-rejected': 15 * 60_000,
  // Someone else is logged in as this user. Never throw them out; look again later.
  'in-use': 2 * 60_000,
  'user-missing': 5 * 60_000,
  'no-world': 60_000,
};

export const STATE_HINT: Record<ClientState, string> = {
  starting: 'The browser starts or the world loads.',
  'logging-in': 'Logging in.',
  ready: 'Logged in and ready.',
  'no-password': 'No password is stored. Set it with: agent-client password <name>',
  'password-rejected':
    'Foundry rejected the password. Set the right one with: agent-client password <name>. Next try in 15 minutes.',
  'in-use':
    'This user is already logged in somewhere else. The client waits and never logs anyone out; it tries again every 2 minutes.',
  'user-missing': 'The world has no user with this id. Check the profile.',
  'no-world': 'Foundry shows no world (setup or login screen). Start the world.',
  error: 'Something failed; the client tries again with growing pauses.',
};

/** Pause after the n-th failure in a row: 15 s, 30 s, 60 s, ... at most 5 minutes. */
export function retryDelayMs(failures: number): number {
  return Math.min(5 * 60_000, 15_000 * 2 ** Math.max(0, failures - 1));
}

/**
 * Two versions of an agent's code: as an expression (`game.user.name`) and,
 * when that is a syntax error, as a function body (`const a = 1; return a`).
 * Both are async, so `await` works. The result is turned into plain JSON in
 * the browser, because Foundry documents themselves cannot be transferred.
 */
export function evaluationCode(code: string): { expression: string; body: string } {
  const wrap = (inner: string) => `(async () => {
  const __value = await (async () => { ${inner} })();
  const __seen = new WeakSet();
  const __text = JSON.stringify(__value === undefined ? null : __value, (k, v) => {
    if (typeof v === 'bigint') return String(v);
    if (typeof v === 'function') return '[function]';
    if (v && typeof v === 'object') {
      if (__seen.has(v)) return '[circular]';
      __seen.add(v);
      if (typeof v.toObject === 'function' && v.documentName) return v.toObject();
    }
    return v;
  });
  return __text === undefined ? null : JSON.parse(__text);
})()`;
  return { expression: wrap(`return (${code}\n);`), body: wrap(code) };
}

/** Software rendering means no graphics card: maps are slow and use a full CPU core. */
export function isSoftwareRenderer(renderer: string | null): boolean {
  return renderer !== null && /swiftshader|llvmpipe|software|basic render/i.test(renderer);
}
