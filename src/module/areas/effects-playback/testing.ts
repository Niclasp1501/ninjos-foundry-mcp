/**
 * What the effects-playback area needs beyond the default fake.
 *
 * `withPlayback`: Foundry's playback methods on a playlist, as far as this
 * package relies on them. A disabled playlist does not start, sequential and
 * shuffle start one track, simultaneous starts all, cycling after
 * simultaneous lands on disabled and stops every track. That last step is
 * unverified in Foundry 14.
 *
 * `withTokenActors`: a token carries the actor of an unlinked token as an
 * embedded Actor, so its uuid resolves like `Scene.x.Token.y.Actor.z`.
 *
 * Both define document types, so call them before seeding.
 */
import {
  DEFAULT_DOCUMENT_TYPES,
  type FakeCollection,
  type FakeDocument,
  type FakeFoundry,
} from '../../../testing/fake-foundry.js';

function method(target: FakeDocument, name: string, value: unknown): void {
  // Not enumerable, so toObject never tries to copy a function.
  Object.defineProperty(target, name, { value, enumerable: false, configurable: true });
}

export function withPlayback(foundry: FakeFoundry): FakeFoundry {
  const spec = DEFAULT_DOCUMENT_TYPES['Playlist'];
  foundry.defineDocumentType('Playlist', {
    ...spec,
    extend: playlist => {
      const tracks = () => playlist['sounds'] as FakeCollection<FakeDocument>;
      const stopTracks = async () => {
        for (const track of tracks().contents) {
          if (track['playing'] === true) await track.update({ playing: false });
        }
      };
      method(playlist, 'playAll', async () => {
        const list = tracks().contents;
        if (playlist['mode'] === -1 || list.length === 0) return playlist;
        const start = playlist['mode'] === 2 ? list : list.slice(0, 1);
        for (const track of start) await track.update({ playing: true });
        return playlist.update({ playing: true });
      });
      method(playlist, 'stopAll', async () => {
        await stopTracks();
        return playlist.update({ playing: false });
      });
      method(playlist, 'cycleMode', async () => {
        const next = Number(playlist['mode'] ?? 0) + 1;
        await stopTracks();
        return playlist.update({ mode: next > 2 ? -1 : next, playing: false });
      });
      method(playlist, 'playSound', async (sound: FakeDocument) => {
        await sound.update({ playing: true });
        return playlist.update({ playing: true });
      });
      method(playlist, 'stopSound', async (sound: FakeDocument) => {
        await sound.update({ playing: false });
        if (!tracks().some(track => track['playing'] === true)) {
          await playlist.update({ playing: false });
        }
        return playlist;
      });
    },
  });
  return foundry;
}

export function withTokenActors(foundry: FakeFoundry): FakeFoundry {
  foundry.defineDocumentType('Token', { embedded: { Actor: 'syntheticActors' } });
  return foundry;
}
