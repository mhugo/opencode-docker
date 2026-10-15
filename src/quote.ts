/**
 * POSIX single-quote escaping.
 *
 * Wraps `value` so that it is passed to a shell as a single literal argument.
 * Every embedded single quote is turned into the `'\''` sequence.
 */
export function shQuote(value: string): string {
  if (value.length === 0) return "''"
  return `'${value.replace(/'/g, "'\\''")}'`
}
