import { describe, expect, it } from "vitest";
import { buildScanRequestBody, MAX_IMAGE_BYTES, NotAnImageError, wrapImage } from "./scan-body";

/**
 * What this endpoint promises is *negative*: whatever a caller sends, the
 * request that reaches Gemini is our prompt, our schema and one image. The
 * whole promise rests on `wrapImage` refusing anything but base64, because the
 * bytes are placed inside a JSON string — so these tests are mostly attempts
 * to get a second field past it.
 */

const stream = (body: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });

const wrapped = async (body: string): Promise<string> =>
  new Response(wrapImage(stream(body))).text();

describe("the envelope", () => {
  it("is the builder's own body, with the image where the image goes", async () => {
    const image = "QUJD";
    expect(await wrapped(image)).toBe(JSON.stringify(buildScanRequestBody(image)));
  });

  it("carries one image and one instruction, whatever the image is", async () => {
    const body = JSON.parse(await wrapped("QUJD")) as {
      contents: { parts: Record<string, unknown>[] }[];
    };
    expect(body.contents).toHaveLength(1);
    const parts = body.contents[0]!.parts;
    expect(parts).toHaveLength(2);
    expect(parts[0]!["inlineData"]).toMatchObject({ mimeType: "image/jpeg", data: "QUJD" });
    expect(typeof parts[1]!["text"]).toBe("string");
  });

  it("arrives in as many pieces as the phone sends it in", async () => {
    const chunks = ["QUJ", "DRE", "VG"];
    const piecemeal = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    });
    const body = await new Response(wrapImage(piecemeal)).text();
    expect(body).toBe(JSON.stringify(buildScanRequestBody(chunks.join(""))));
  });
});

describe("what it refuses", () => {
  // The one that matters: a quote closes the JSON string the image sits in,
  // and everything after it would be a request the caller wrote.
  it.each([
    ['a quote', 'QUJD","x":"'],
    ['a backslash', "QUJD\\"],
    ['a brace', "QUJD}]}"],
    ['a newline', "QUJD\n"],
    ['a space', "QUJD "],
    ['non-ASCII', "QUJDé"],
  ])("%s", async (_what, body) => {
    await expect(wrapped(body)).rejects.toThrow(NotAnImageError);
  });

  it("an image larger than we ever send", async () => {
    await expect(wrapped("Q".repeat(MAX_IMAGE_BYTES + 1))).rejects.toThrow(NotAnImageError);
  });

  it("but not an image right up to the cap", async () => {
    await expect(wrapped("Q".repeat(MAX_IMAGE_BYTES))).resolves.toContain("inlineData");
  });
});
