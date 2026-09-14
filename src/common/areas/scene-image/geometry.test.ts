import { describe, expect, it } from 'vitest';
import {
  MAX_DIMENSION,
  base64Bytes,
  boundedInteger,
  cellCount,
  cellOf,
  cropRect,
  dataUrlParts,
  gridTypeWord,
  labelEvery,
  outputSize,
  readRegion,
  sceneRect,
  shrink,
} from './geometry.js';

describe('scene rectangle and cells', () => {
  it('rounds the padding up to whole cells on each side', () => {
    expect(sceneRect(1000, 800, 0.25, 100)).toEqual({ x: 300, y: 200, width: 1000, height: 800 });
    expect(sceneRect(1000, 800, 0, 100)).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
  });

  it('counts partial cells and places points in cells from the scene corner', () => {
    const rect = sceneRect(1050, 800, 0.25, 100);
    expect(cellCount(rect, 100)).toEqual({ columns: 11, rows: 8 });
    expect(cellOf(rect, 100, rect.x + 250, rect.y + 99)).toEqual({ column: 2, row: 0 });
  });

  it('names the grid types', () => {
    expect(gridTypeWord(0)).toBe('gridless');
    expect(gridTypeWord(1)).toBe('square');
    expect(gridTypeWord(4)).toBe('hexagonal-odd-columns');
    expect(gridTypeWord(undefined)).toBe('square');
  });
});

describe('region', () => {
  const scene = { x: 100, y: 100, width: 1000, height: 800 };

  it('reads a complete region and refuses anything else with every problem', () => {
    expect(readRegion({ column: 1, row: 2, columns: 3, rows: 4 })).toEqual({
      region: { column: 1, row: 2, columns: 3, rows: 4 },
      problems: [],
    });
    expect(readRegion({ column: -1, row: 1.5, columns: 0 }).problems).toEqual([
      'region.column must be a whole number of at least 0',
      'region.row must be a whole number of at least 0',
      'region.columns must be a whole number of at least 1',
      'region.rows must be a whole number of at least 1',
    ]);
  });

  it('crops to cells, clips at the edge with a note, and refuses a start outside', () => {
    expect(cropRect(scene, 100, { column: 2, row: 1, columns: 3, rows: 2 })).toEqual({
      rect: { x: 300, y: 200, width: 300, height: 200 },
      region: { column: 2, row: 1, columns: 3, rows: 2 },
    });
    const clipped = cropRect(scene, 100, { column: 8, row: 6, columns: 5, rows: 5 });
    expect(clipped.rect).toEqual({ x: 900, y: 700, width: 200, height: 200 });
    expect(clipped.note).toContain('clipped');
    expect(cropRect(scene, 100, { column: 10, row: 0, columns: 1, rows: 1 }).problem).toContain(
      'columns 0 to 9'
    );
  });
});

describe('sizes and encoding helpers', () => {
  it('scales the long edge down, never up', () => {
    expect(outputSize(4000, 2000, 1000)).toEqual({ width: 1000, height: 500, scale: 0.25 });
    expect(outputSize(400, 200, 1000)).toEqual({ width: 400, height: 200, scale: 1 });
  });

  it('shrinks until the smallest long edge', () => {
    expect(shrink(1000, 500)).toEqual({ width: 750, height: 375 });
    expect(shrink(MAX_DIMENSION.min, 100)).toBeNull();
  });

  it('reads data URLs and counts Base64 bytes', () => {
    expect(dataUrlParts('data:image/jpeg;base64,QUJD')).toEqual({
      mimeType: 'image/jpeg',
      data: 'QUJD',
    });
    expect(dataUrlParts('not a data url')).toBeNull();
    expect(base64Bytes('QUJD')).toBe(3);
    expect(base64Bytes('QUI=')).toBe(2);
    expect(base64Bytes('QQ==')).toBe(1);
  });

  it('spaces labels', () => {
    expect(labelEvery(50)).toBe(1);
    expect(labelEvery(8)).toBe(5);
  });

  it('checks bounded whole numbers', () => {
    const problems: string[] = [];
    expect(boundedInteger(undefined, 'n', { default: 5, min: 1, max: 9 }, problems)).toBe(5);
    expect(boundedInteger(12, 'n', { default: 5, min: 1, max: 9 }, problems)).toBe(5);
    expect(problems).toEqual(['n must be a whole number from 1 to 9']);
  });
});
