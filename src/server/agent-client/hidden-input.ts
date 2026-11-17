/**
 * Reads a password from the terminal without showing it.
 *
 * Refuses when standard input is not a terminal: a password piped in by a
 * script or an agent would sit in that script, its history or its log, which
 * is exactly what this tool exists to avoid. On Windows that means PowerShell,
 * Command Prompt or Windows Terminal; Git Bash (mintty) is not a terminal to
 * Node.
 */
export class HiddenInputError extends Error {}

export function askHidden(question: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(
      new HiddenInputError(
        'The password can only be typed in a terminal (PowerShell, Command Prompt, Terminal), not piped in.'
      )
    );
  }
  return new Promise((resolve, reject) => {
    process.stdout.write(question);
    const typed: string[] = [];
    const wasRaw = input.isRaw;
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');

    const finish = (error: Error | null) => {
      input.setRawMode(wasRaw);
      input.pause();
      input.removeListener('data', onData);
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(typed.join(''));
      typed.length = 0;
    };

    function onData(chunk: string) {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return finish(null);
        if (char === '\u0003') return finish(new HiddenInputError('Cancelled'));
        if (char === '\u0004' && typed.length === 0)
          return finish(new HiddenInputError('Cancelled'));
        if (char === '\u007f' || char === '\b') {
          typed.pop();
          continue;
        }
        // Escape sequences (arrow keys) are not part of a password.
        if (char === '\u001b' || char < ' ') continue;
        typed.push(char);
      }
    }
    input.on('data', onData);
  });
}
