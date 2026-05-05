import { describe, expect, it } from "vitest";
import { urlEncodePath } from "../src/util/url.js";
import { stripAnsi } from "../src/util/ansi.js";

describe("urlEncodePath", () => {
  it("encodes forward slashes as %2F", () => {
    expect(urlEncodePath("src/components/Button.tsx")).toBe(
      "src%2Fcomponents%2FButton.tsx",
    );
  });

  it("encodes a single segment with no slashes verbatim (no ops needed)", () => {
    expect(urlEncodePath("README.md")).toBe("README.md");
  });

  it("encodes nested group/repo paths", () => {
    expect(urlEncodePath("jakota/group/repo")).toBe(
      "jakota%2Fgroup%2Frepo",
    );
  });

  it("encodes spaces as %20", () => {
    expect(urlEncodePath("docs/Style Guide.md")).toBe(
      "docs%2FStyle%20Guide.md",
    );
  });

  it("encodes other reserved characters", () => {
    expect(urlEncodePath("a?b&c=d")).toBe("a%3Fb%26c%3Dd");
  });

  it("preserves dots and parentheses (encodeURIComponent leaves them)", () => {
    expect(urlEncodePath("foo.bar(baz)")).toBe("foo.bar(baz)");
  });

  it("does NOT trim leading/trailing whitespace from valid paths (whitespace is data)", () => {
    expect(urlEncodePath(" src/foo.ts ")).toBe("%20src%2Ffoo.ts%20");
  });

  it("throws on an empty string", () => {
    expect(() => urlEncodePath("")).toThrow(/non-empty/);
  });

  it("throws on whitespace-only input", () => {
    expect(() => urlEncodePath("   \n\t")).toThrow(/non-empty/);
  });

  it("throws when given non-string (defensive — should never happen with strict types)", () => {
    expect(() =>
      urlEncodePath(undefined as unknown as string),
    ).toThrow(/non-empty/);
  });
});

describe("stripAnsi", () => {
  it("returns empty string unchanged", () => {
    expect(stripAnsi("")).toBe("");
  });

  it("returns plain text unchanged when there are no escapes", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });

  it("strips a basic SGR (red foreground) sequence", () => {
    expect(stripAnsi("\x1b[31mERROR\x1b[0m")).toBe("ERROR");
  });

  it("strips compound SGR (bold + cyan)", () => {
    expect(stripAnsi("\x1b[1;36mhello\x1b[0m")).toBe("hello");
  });

  it("strips clear-line / clear-to-EOL", () => {
    expect(stripAnsi("\x1b[2K\rrebuilding...\x1b[0K")).toBe(
      "\rrebuilding...",
    );
  });

  it("strips the GitLab CI 'section_start coloring' SGR fragment but leaves the section text", () => {
    const input =
      "\x1b[0K\x1b[32;1m$ npm install\x1b[0;m\nrunning install\n";
    expect(stripAnsi(input)).toBe("$ npm install\nrunning install\n");
  });

  it("strips OSC sequences terminated by BEL (window title)", () => {
    expect(stripAnsi("before\x1b]0;title\x07after")).toBe("beforeafter");
  });

  it("strips OSC sequences terminated by ESC \\ (string terminator)", () => {
    expect(stripAnsi("before\x1b]8;;https://example\x1b\\link\x1b]8;;\x1b\\after"))
      .toBe("beforelinkafter");
  });

  it("strips 2-byte ESC sequences", () => {
    expect(stripAnsi("a\x1bDb")).toBe("ab"); // \eD = index/linefeed
  });

  it("does NOT touch GitLab's section_start / section_end markers (not ANSI)", () => {
    const input = "section_start:1234567890:install\nfoo\nsection_end:1234567890:install\n";
    expect(stripAnsi(input)).toBe(input);
  });

  it("handles a realistic mixed CI fragment", () => {
    const input =
      "\x1b[0K\x1b[32;1m$ npm test\x1b[0;m\n" +
      "\x1b[31;1mFAIL\x1b[0m tests/foo.test.ts\n" +
      "  \x1b[33mwarning\x1b[0m: deprecated\n";
    expect(stripAnsi(input)).toBe(
      "$ npm test\n" + "FAIL tests/foo.test.ts\n" + "  warning: deprecated\n",
    );
  });
});
