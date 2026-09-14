import { describe, expect, it } from 'vitest';
import { readToolDirectory } from '../../../testing/tool-directory.js';
import { pf2eArea } from './index.js';

describe('the pf2e tool', () => {
  it('is new: no tool of the previous generation carries a pf2e name', () => {
    expect(pf2eArea.tools?.map(tool => tool.name)).toEqual(['pf2e-manage-conditions']);
    const names = readToolDirectory().map(tool => tool.name);
    expect(names.filter(name => name.startsWith('pf2e'))).toEqual([]);
    expect(names).not.toContain('pf2e-manage-conditions');
  });

  it('writes descriptions without dashes as sentence dashes and marks removal as destructive', () => {
    const tool = pf2eArea.tools![0]!;
    expect(JSON.stringify([tool.description, tool.inputSchema])).not.toMatch(/[–—]/);
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(tool.group).toBe('systems');
    expect(pf2eArea.adapters?.[0]?.id).toBe('pf2e');
  });
});
