/**
 * Always-on stderr line emitted whenever a tool clamps the size of a
 * payload it returns. Matches the [WRITE] paper-trail pattern in
 * `gitlab-client.ts#requestWrite` — emitted regardless of any DEBUG flag.
 *
 * Format: `[TRUNCATE] tool=foo original_bytes=N returned_bytes=M limit=L key=value...\n`
 */
export function logTruncate(opts: {
  tool: string;
  originalBytes: number;
  returnedBytes: number;
  limit: number;
  details?: Record<string, string | number | boolean>;
}): void {
  const tail = opts.details
    ? " " +
      Object.entries(opts.details)
        .map(([k, v]) => `${k}=${typeof v === "string" ? JSON.stringify(v) : v}`)
        .join(" ")
    : "";
  process.stderr.write(
    `[TRUNCATE] tool=${opts.tool} original_bytes=${opts.originalBytes} returned_bytes=${opts.returnedBytes} limit=${opts.limit}${tail}\n`,
  );
}
