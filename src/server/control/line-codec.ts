/**
 * Line delimited JSON on a TCP stream: one message per line.
 *
 * Shared by the control server in the backend and the client in the wrapper.
 */

/** A single line longer than this ends the connection instead of filling memory. */
export const MAX_LINE_BYTES = 32 * 1024 * 1024;

export class LineSplitter {
  private buffer = '';

  constructor(private readonly maxLength: number = MAX_LINE_BYTES) {}

  /** Returns the complete lines in the chunk, or throws when a line grows past the limit. */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let index = this.buffer.indexOf('\n');
    while (index !== -1) {
      const line = this.buffer.slice(0, index).replace(/\r$/, '');
      this.buffer = this.buffer.slice(index + 1);
      if (line.trim()) lines.push(line);
      index = this.buffer.indexOf('\n');
    }
    if (this.buffer.length > this.maxLength) {
      this.buffer = '';
      throw new Error(`a control line exceeded ${this.maxLength} characters`);
    }
    return lines;
  }

  /** What has arrived but has no line end yet. */
  get pending(): string {
    return this.buffer;
  }
}

export interface ControlRequest {
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export type ControlLine =
  | { id: string | number; result: unknown }
  | { id?: string | number; error: { message: string; code?: string } }
  | { id: string | number; progress: { progress: number; total?: number; message?: string } }
  /** Only to a client that called `watch`. */
  | { event: Record<string, unknown> & { type: string } };

export function encodeLine(message: ControlLine | ControlRequest): string {
  return `${JSON.stringify(message)}\n`;
}
