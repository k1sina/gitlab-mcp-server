/**
 * URL-encode a forward-slashed path so it is safe to drop in as a single
 * URL path segment. Slashes become `%2F`, spaces `%20`, etc.
 *
 * Used for:
 *  - GitLab file paths in the repository file API ("src/Foo.tsx").
 *  - Project IDs given as paths ("group/repo"). Numeric ids should NOT
 *    go through this — pass the digits through verbatim.
 *
 * Whitespace in a real path is data (someone named a folder ` foo `,
 * which is awful but valid), so we do not silently trim. Empty / blank
 * input throws.
 */
export function urlEncodePath(path: string): string {
  if (typeof path !== "string" || path.trim().length === 0) {
    throw new Error("urlEncodePath: path must be a non-empty string");
  }
  return encodeURIComponent(path);
}
