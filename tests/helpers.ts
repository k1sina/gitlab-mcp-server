import { vi, type Mock } from "vitest";

export interface FakeFetchCall {
  url: string;
  init: RequestInit;
}

/**
 * Returns a vitest Mock standing in for `globalThis.fetch`. Each call is
 * recorded and the next queued response is delivered.
 *
 * `responses` is treated as a FIFO queue. Each entry can be:
 *  - { ok: true, status, body, contentType?, raw? } — body is delivered via
 *    .json() (default) and .text(); if `raw` is a Buffer/Uint8Array, it
 *    becomes the source of arrayBuffer() and text() instead. Useful for
 *    binary-detection tests.
 *  - { ok: false, status, statusText, body } — body is delivered via .text();
 *    if `body` is an object it is JSON.stringify'd to mimic GitLab's
 *    Content-Type: application/json error responses.
 */
export type QueuedResponse =
  | {
      ok: true;
      status: number;
      body: unknown;
      contentType?: string;
      raw?: Buffer | Uint8Array;
    }
  | {
      ok: false;
      status: number;
      statusText?: string;
      body?: unknown;
      contentType?: string;
    };

export function installFetchMock(responses: QueuedResponse[]): Mock {
  const queue = [...responses];
  const fn = vi.fn(async (url: string, _init?: RequestInit) => {
    const r = queue.shift();
    if (!r) throw new Error(`fetch mock exhausted for ${url}`);
    return makeResponse(r);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function makeResponse(opts: QueuedResponse): Response {
  const raw = "raw" in opts ? opts.raw : undefined;
  const buf: Buffer | undefined = raw
    ? raw instanceof Buffer
      ? raw
      : Buffer.from(raw)
    : undefined;
  const text = buf
    ? buf.toString("utf8")
    : "body" in opts && opts.body !== undefined
      ? typeof opts.body === "string"
        ? opts.body
        : JSON.stringify(opts.body)
      : "";
  const contentType = opts.contentType ?? null;
  return {
    ok: opts.ok,
    status: opts.status,
    statusText: "statusText" in opts ? (opts.statusText ?? "") : "",
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type" ? contentType : null,
    } as unknown as Headers,
    json: async () =>
      "body" in opts && opts.body !== undefined ? opts.body : undefined,
    text: async () => text,
    arrayBuffer: async () => {
      const source = buf ?? Buffer.from(text, "utf8");
      // Return a fresh ArrayBuffer slice so callers cannot mutate the source.
      const ab = new ArrayBuffer(source.byteLength);
      Buffer.from(ab).set(source);
      return ab;
    },
  } as unknown as Response;
}

export function captureStderr() {
  const buf: string[] = [];
  const spy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      buf.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    });
  return {
    spy,
    text: () => buf.join(""),
    restore: () => spy.mockRestore(),
  };
}
