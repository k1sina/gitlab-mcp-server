// Match the standard ANSI escape families seen in CI logs:
//   - CSI:  ESC '[' …params… letter   (SGR colors, clear-line, cursor moves)
//   - OSC:  ESC ']' … BEL | ESC '\\'   (window titles, terminal links)
//   - 2-byte: ESC followed by a single control char
const ANSI_RE =
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][\s\S]*?(?:\x07|\x1b\\)|\x1b[@-_]/g;

/**
 * Remove ANSI escape sequences from a string. Sufficient for the SGR
 * (color) + clear-line + cursor-move escapes GitLab CI emits. Does NOT
 * touch GitLab's own `section_start:` / `section_end:` markers — those
 * are not ANSI.
 */
export function stripAnsi(input: string): string {
  return input.replace(ANSI_RE, "");
}
