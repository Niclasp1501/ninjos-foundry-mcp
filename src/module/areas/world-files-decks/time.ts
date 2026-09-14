/**
 * World time and pause.
 *
 * - The time is Foundry's `game.time.worldTime` in seconds. When the world has
 *   a calendar (`game.time.calendar`, Foundry 13 and later), its components
 *   and formatted text are added; a calendar that fails to format is named, the
 *   seconds still come.
 * - Advancing goes through `game.time.advance`, so every hook of the core,
 *   the system and calendar modules runs as for a Gamemaster at the table.
 *   The new time is read back; a different value is an error with both values.
 * - Pausing goes through `game.togglePause` with broadcast, so every client
 *   pauses. A pause that already is in the wanted state changes nothing.
 * - Neither has a document kind: the rights are the write switch only.
 */
import { WRITE_SWITCH_ONLY } from '../../../common/permissions.js';
import { QueryError, type QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import {
  inputOf,
  invalid,
  messageOf,
  optionalBoolean,
  recordWorldChange,
  worldGame,
} from './common.js';

/** Ten years of 365.25 days: more in one step is almost surely a mistake. */
export const MAX_ADVANCE_SECONDS = 315_576_000;

function clock(): FoundryWorldFilesDecksTime {
  const time = worldGame().time;
  if (!time || typeof time.worldTime !== 'number')
    throw new QueryError('NOT_AVAILABLE', "Foundry's world time (game.time) is not available");
  return time;
}

export function describeTime(time: FoundryWorldFilesDecksTime, seconds: number) {
  const calendar = time.calendar;
  const out: Record<string, unknown> = { worldTime: seconds, calendar: null };
  if (!calendar) return out;
  const info: Record<string, unknown> = {
    name: typeof calendar.name === 'string' ? calendar.name : null,
  };
  try {
    if (typeof calendar.timeToComponents === 'function')
      info['components'] = calendar.timeToComponents(seconds);
  } catch (error) {
    info['problem'] = `The calendar could not split the time: ${messageOf(error)}`;
  }
  try {
    if (typeof calendar.format === 'function') {
      const text = calendar.format(seconds);
      if (typeof text === 'string') info['formatted'] = text;
    }
  } catch (error) {
    info['problem'] = `The calendar could not format the time: ${messageOf(error)}`;
  }
  out['calendar'] = info;
  return out;
}

export const getWorldTime: QueryHandler = {
  access: { kind: 'read' },
  run: () => {
    requireWorld();
    const time = clock();
    return { ...describeTime(time, time.worldTime), paused: worldGame().paused === true };
  },
};

function secondsOf(data: unknown): number {
  const raw = inputOf(data)['seconds'];
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw === 0)
    throw invalid(`seconds must be a whole number other than 0, got ${JSON.stringify(raw)}`);
  if (Math.abs(raw) > MAX_ADVANCE_SECONDS)
    throw invalid(
      `seconds must be at most ${MAX_ADVANCE_SECONDS} either way (ten years), got ${raw}`
    );
  return raw;
}

export const advanceWorldTime: QueryHandler = {
  access: data => (inputOf(data)['dryRun'] === true ? { kind: 'read' } : WRITE_SWITCH_ONLY),
  run: async (data, context) => {
    requireWorld();
    const seconds = secondsOf(data);
    const dryRun = optionalBoolean(inputOf(data), 'dryRun') === true;
    const time = clock();
    const before = time.worldTime;
    const expected = before + seconds;
    if (dryRun) {
      return {
        dryRun: true,
        seconds,
        before: describeTime(time, before),
        after: describeTime(time, expected),
      };
    }
    try {
      await time.advance(seconds);
    } catch (error) {
      const now = time.worldTime;
      throw new QueryError(
        'ADVANCE_FAILED',
        `Foundry refused to advance the world time by ${seconds} seconds: ${messageOf(error)}. ` +
          (now === before ? 'The time is unchanged.' : `The time is now ${now} (was ${before}).`)
      );
    }
    const after = clock().worldTime;
    if (after !== expected) {
      throw new QueryError(
        'NOT_APPLIED',
        `The world time reads ${after} after advancing, expected ${expected} (was ${before}). A hook of the ` +
          'system or a module may have changed it as well.'
      );
    }
    recordWorldChange(context, 'WorldTime', {
      query: 'advanceWorldTime',
      tool: 'advance-world-time',
      action: 'update',
      targets: [],
      summary: `Advanced the world time by ${seconds} seconds, from ${before} to ${after}.`,
      before: { worldTime: before },
      after: { worldTime: after },
    });
    return {
      dryRun: false,
      seconds,
      before: describeTime(time, before),
      after: describeTime(time, after),
    };
  },
};

export const setGamePause: QueryHandler = {
  access: WRITE_SWITCH_ONLY,
  run: async (data, context) => {
    requireWorld();
    const paused = optionalBoolean(inputOf(data), 'paused');
    if (paused === undefined) throw invalid('paused is required: true to pause, false to resume');
    const worldState = worldGame();
    if (typeof worldState.togglePause !== 'function')
      throw new QueryError('NOT_AVAILABLE', "Foundry's game.togglePause is not available");
    const before = worldState.paused === true;
    if (before === paused) return { paused, changed: false };
    try {
      await worldState.togglePause(paused, { broadcast: true });
    } catch (error) {
      throw new QueryError(
        'PAUSE_FAILED',
        `Foundry refused to ${paused ? 'pause' : 'resume'} the game: ${messageOf(error)}`
      );
    }
    const after = worldGame().paused === true;
    if (after !== paused) {
      throw new QueryError(
        'NOT_APPLIED',
        `The game is still ${after ? 'paused' : 'running'} after asking Foundry to ${paused ? 'pause' : 'resume'} it.`
      );
    }
    recordWorldChange(context, 'Pause', {
      query: 'setGamePause',
      tool: 'set-game-pause',
      action: 'update',
      targets: [],
      summary: paused ? 'Paused the game for everyone.' : 'Resumed the game for everyone.',
      before: { paused: before },
      after: { paused: after },
    });
    return { paused, changed: true };
  },
};
