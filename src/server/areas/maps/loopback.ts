/** Whether an address stays on this PC. */
export function isLoopbackHost(host: string): boolean {
  const bare = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  return bare === 'localhost' || bare === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare);
}
