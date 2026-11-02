import { describe, expect, it } from "vitest";
import { readText } from "./github.js";

// A response with no content-length, sent in pieces, as a chunked one arrives.
function chunked(parts: Uint8Array[]): Response {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = parts[pulled++];
      if (next) controller.enqueue(next);
      else controller.close();
    },
  });
  return new Response(body);
}

const bytes = (n: number, fill = 120) => new Uint8Array(n).fill(fill);

describe("readText", () => {
  it("reads a small text body", async () => {
    expect(await readText(chunked([new TextEncoder().encode("K=1\nJ=2")]))).toBe("K=1\nJ=2");
  });

  it("gives up on a body that grows past the limit, without reading the rest", async () => {
    let served = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        served++;
        controller.enqueue(bytes(256 * 1024));
      },
    });
    expect(await readText(new Response(endless))).toBeNull();
    expect(served).toBeLessThan(5);
  });

  it("skips binary files", async () => {
    expect(await readText(chunked([bytes(10), bytes(1, 0)]))).toBeNull();
  });

  it("trusts a content-length that's already too big", async () => {
    const res = new Response("x", { headers: { "content-length": String(10 * 1024 * 1024) } });
    expect(await readText(res)).toBeNull();
  });
});
