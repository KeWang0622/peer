/**
 * Minimal ANSI color tokens. No deps.
 * Set NO_COLOR=1 to disable.
 */
const useColor = !process.env.NO_COLOR && process.stdout.isTTY;

function wrap(code: string): (s: string) => string {
  return (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
}

export const c = {
  bold: wrap("1"),
  dim: wrap("2"),
  italic: wrap("3"),
  underline: wrap("4"),
  red: wrap("31"),
  green: wrap("32"),
  yellow: wrap("33"),
  blue: wrap("34"),
  magenta: wrap("35"),
  cyan: wrap("36"),
  white: wrap("37"),
  gray: wrap("90"),
  accent: wrap("38;5;180"),     // soft amber
  primary: wrap("38;5;75"),     // soft blue
  ok: wrap("38;5;114"),         // soft green
  warn: wrap("38;5;179"),       // dim yellow
  bad: wrap("38;5;167"),        // soft red
};

export function bar(width = 76, char = "─"): string {
  return char.repeat(width);
}
