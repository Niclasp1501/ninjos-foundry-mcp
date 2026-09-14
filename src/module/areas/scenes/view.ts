/**
 * Activating a scene for everyone, and fitting the view.
 *
 * The active scene is the one activated for all players, not the one the
 * Gamemaster happens to look at. Activation is read back from the scene.
 */
import { messageOf } from './support.js';

export async function activateScene(
  scene: FoundryScenesScene
): Promise<{ active: true } | { active: false; reason: string }> {
  try {
    if (typeof scene.activate === 'function') await scene.activate();
    else await scene.update({ active: true });
  } catch (error) {
    return { active: false, reason: messageOf(error) };
  }
  return scene.active === true
    ? { active: true }
    : { active: false, reason: 'Foundry does not show the scene as active afterwards' };
}

function currentCanvas(): FoundryScenesCanvas | undefined {
  return (globalThis as { canvas?: FoundryScenesCanvas }).canvas;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Pan to the middle of the map and zoom so the whole map fits, once the canvas shows the scene. */
export async function optimizeView(
  scene: FoundryScenesScene,
  waitMs = 5000
): Promise<{ optimized: boolean; reason?: string }> {
  let canvas = currentCanvas();
  if (!canvas) return { optimized: false, reason: 'there is no canvas in this browser' };
  const until = Date.now() + waitMs;
  while (!(canvas?.ready && canvas.scene?.id === scene.id)) {
    if (Date.now() >= until)
      return {
        optimized: false,
        reason: `the canvas did not show the scene within ${waitMs / 1000} seconds`,
      };
    await sleep(100);
    canvas = currentCanvas();
  }

  const screen = canvas.screenDimensions ?? [];
  const [screenWidth, screenHeight] = [screen[0] ?? 0, screen[1] ?? 0];
  if (!(scene.width > 0 && scene.height > 0 && screenWidth > 0 && screenHeight > 0))
    return { optimized: false, reason: 'the scene or the screen reports no size' };
  const dimensions = canvas.dimensions ?? { width: scene.width, height: scene.height };
  const view = {
    x: dimensions.width / 2,
    y: dimensions.height / 2,
    scale: Math.min(screenWidth / scene.width, screenHeight / scene.height) * 0.95,
  };
  try {
    if (typeof canvas.animatePan === 'function')
      await canvas.animatePan({ ...view, duration: 250 });
    else if (typeof canvas.pan === 'function') canvas.pan(view);
    else return { optimized: false, reason: 'the canvas offers no way to pan' };
  } catch (error) {
    return { optimized: false, reason: messageOf(error) };
  }
  return { optimized: true };
}
