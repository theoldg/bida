import { describe, expect, it } from "vitest";
import { buildScanRequestBody } from "@bida/core";
import {
  MAX_IMAGE_BYTES, MAX_TEXT_BYTES, NotBase64Error,
  type ScanMedium, type ScanTone, wrapPayload,
} from "./scan-body";

/**
 * What this endpoint promises is *negative*: whatever a caller sends, the
 * request that reaches Gemini is our prompt, our schema and one bill. The
 * whole promise rests on `wrapPayload` refusing anything but base64, because the
 * bytes are placed inside a JSON string — so these tests are mostly attempts
 * to get a second field past it.
 *
 * A typed bill is base64 for exactly that reason: the caller's words reach the
 * model, and the caller's *bytes* still cannot reach the request.
 */

const stream = (body: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });

const wrapped = async (body: string, tone?: ScanTone, medium?: ScanMedium): Promise<string> =>
  new Response(wrapPayload(stream(body), undefined, tone, medium)).text();

/** The one instruction in the envelope, whichever tone asked for it. */
const promptOf = (body: string): string =>
  ((JSON.parse(body) as { contents: { parts: { text?: string }[] }[] })
    .contents[0]!.parts[1]!.text) ?? "";

describe("the envelope", () => {
  it("is the builder's own body, with the bill where the bill goes", async () => {
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
    const body = await new Response(wrapPayload(piecemeal)).text();
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
    await expect(wrapped(body)).rejects.toThrow(NotBase64Error);
  });

  it("an image larger than we ever send", async () => {
    await expect(wrapped("Q".repeat(MAX_IMAGE_BYTES + 1))).rejects.toThrow(NotBase64Error);
  });

  it("but not an image right up to the cap", async () => {
    await expect(wrapped("Q".repeat(MAX_IMAGE_BYTES))).resolves.toContain("inlineData");
  });

  // The typed bill's cap is its own, and far below the photo's — an abuse
  // ceiling on what the dialog already limits to 4,000 characters. A body sent
  // as text does not get to spend the image allowance.
  it("a typed bill larger than the text cap", async () => {
    await expect(wrapped("Q".repeat(MAX_TEXT_BYTES + 1), "kind", "text"))
      .rejects.toThrow(NotBase64Error);
  });

  it("but not one right up to it", async () => {
    await expect(wrapped("Q".repeat(MAX_TEXT_BYTES), "kind", "text"))
      .resolves.toContain("inlineData");
  });

  it("and never the image cap's worth of it", async () => {
    expect(MAX_TEXT_BYTES).toBeLessThan(MAX_IMAGE_BYTES);
    await expect(wrapped("Q".repeat(MAX_IMAGE_BYTES), "kind", "text"))
      .rejects.toThrow(NotBase64Error);
  });

  it("a typed bill that is not base64 either", async () => {
    await expect(wrapped('QUJD","x":"', "kind", "text")).rejects.toThrow(NotBase64Error);
  });
});

/**
 * Staś mode moves one paragraph of the prompt and must move nothing else: a
 * mean refusal is a joke, a differently-read receipt is a wrong bill. The
 * tone also arrives as a *header*, so what is tested here is that it picks
 * between two envelopes we hold rather than putting any of it in a caller's
 * hands — the promise the rest of this file is about.
 */
describe("the two tones", () => {
  it("is the kind one when nobody asks", async () => {
    expect(await wrapped("QUJD")).toBe(await wrapped("QUJD", "kind"));
  });

  it("carries the image untouched either way", async () => {
    expect(await wrapped("QUJD", "stas")).toBe(JSON.stringify(buildScanRequestBody("QUJD", "stas")));
  });

  // The one sentence the two tones contradict each other on, and the whole
  // point of the second: Staś mode is at the photographer's expense.
  it("spares the photographer in one tone and not the other", async () => {
    const spare = "never at the photographer's expense";
    expect(promptOf(await wrapped("QUJD", "kind"))).toContain(spare);
    expect(promptOf(await wrapped("QUJD", "stas"))).not.toContain(spare);
  });

  it("refuses a non-image in Staś mode too", async () => {
    await expect(wrapped('QUJD","x":"', "stas")).rejects.toThrow(NotBase64Error);
  });

  it("changes only how a photo is refused — never how a bill is read", async () => {
    const [kind, stas] = [promptOf(await wrapped("QUJD")), promptOf(await wrapped("QUJD", "stas"))];
    // Everything before the refusal paragraph is the reading instructions, and
    // everything after it is the cropped-receipt rule: both are word for word
    // the same, or the two tones would be two different readers.
    const marker = "If the photo isn't a receipt at all,";
    expect(kind.slice(0, kind.indexOf(marker))).toBe(stas.slice(0, stas.indexOf(marker)));
    const tail = "The same applies if the receipt is cropped,";
    expect(kind.slice(kind.indexOf(tail))).toBe(stas.slice(stas.indexOf(tail)));
    expect(kind).not.toBe(stas);
  });

  it("still tells the photographer what is wrong, meanly or not", async () => {
    for (const tone of ["kind", "stas"] as const) {
      expect(promptOf(await wrapped("QUJD", tone))).toContain("what to re-shoot");
    }
  });
});

/**
 * A bill somebody typed is read by the same rules as one photographed. What the
 * two envelopes are allowed to differ on is the medium — how the bill is
 * attached, the advice about its layout, and how it is refused — and nothing
 * else: a typed bill that read by different rules would price a split
 * differently depending on whether anybody had a camera to hand.
 */
describe("the two media", () => {
  it("is the photo when nobody asks", async () => {
    expect(await wrapped("QUJD")).toBe(await wrapped("QUJD", "kind", "photo"));
  });

  it("attaches a photo as a JPEG and a typed bill as plain text", async () => {
    const partOf = (body: string) =>
      (JSON.parse(body) as { contents: { parts: Record<string, unknown>[] }[] })
        .contents[0]!.parts[0]!["inlineData"];
    expect(partOf(await wrapped("QUJD", "kind", "photo")))
      .toMatchObject({ mimeType: "image/jpeg", data: "QUJD" });
    expect(partOf(await wrapped("QUJD", "kind", "text")))
      .toMatchObject({ mimeType: "text/plain", data: "QUJD" });
  });

  it("still carries one bill and one instruction", async () => {
    const parts = (JSON.parse(await wrapped("QUJD", "kind", "text")) as
      { contents: { parts: Record<string, unknown>[] }[] }).contents[0]!.parts;
    expect(parts).toHaveLength(2);
  });

  it("asks for the same fields, by the same schema", async () => {
    const schemaOf = (body: string) =>
      (JSON.parse(body) as { generationConfig: unknown }).generationConfig;
    expect(schemaOf(await wrapped("QUJD", "kind", "text")))
      .toEqual(schemaOf(await wrapped("QUJD", "kind", "photo")));
  });

  /**
   * The invariant the whole split is for: what a bill is read *by* is one
   * shared constant, so all four envelopes read one identically. It comes in
   * two blocks with the layout advice between them — that paragraph is the one
   * thing a medium may genuinely disagree about — and each is sliced between two
   * sentences neither medium nor tone may move.
   */
  it("reads a bill by rules no tone and no medium can move", async () => {
    const between = (prompt: string, open: string, close: string) => {
      const from = prompt.indexOf(open);
      const to = prompt.indexOf(close);
      expect(from).toBeGreaterThan(-1);
      expect(to).toBeGreaterThan(from);
      return prompt.slice(from, to + close.length);
    };
    const rules = (prompt: string) => [
      between(prompt, "Return a title for the expense", "never a product you work out yourself."),
      between(prompt, "No line item's amount is negative", "only reformat the separators."),
    ];
    const prompts = await Promise.all((["kind", "stas"] as const).flatMap((tone) =>
      (["photo", "text"] as const).map((medium) => wrapped("QUJD", tone, medium))));
    const [first, ...rest] = prompts.map((body) => rules(promptOf(body)));
    expect(first![0]).toContain("Keep the whole title under 40 characters");
    for (const other of rest) expect(other).toEqual(first);
    // And all four really are four: identical rules, four different prompts.
    expect(new Set(prompts).size).toBe(4);
  });

  it("never asks a typed bill to be re-shot", async () => {
    for (const tone of ["kind", "stas"] as const) {
      // Only the refusal is looked at: the lead paragraph says "not
      // photographed", which is the point of it.
      const prompt = promptOf(await wrapped("QUJD", tone, "text"));
      const refusal = prompt.slice(prompt.indexOf("If the text isn't a bill"));
      expect(refusal).not.toContain("re-shoot");
      expect(refusal).not.toContain("blurry");
      expect(refusal).not.toContain("photo");
      // It still has to say what is missing, which is the whole job of a refusal.
      expect(refusal).toContain("what is missing");
    }
  });

  it("keeps the photo's own advice out of the typed bill and vice versa", async () => {
    const shear = "a receipt shot at an angle shears them";
    expect(promptOf(await wrapped("QUJD", "kind", "photo"))).toContain(shear);
    expect(promptOf(await wrapped("QUJD", "kind", "text"))).not.toContain(shear);
  });

  it("spares the sender in one tone and not the other, typed too", async () => {
    const spare = "never at the sender's expense";
    expect(promptOf(await wrapped("QUJD", "kind", "text"))).toContain(spare);
    expect(promptOf(await wrapped("QUJD", "stas", "text"))).not.toContain(spare);
  });

  it("leaves what somebody was born as alone in the mean typed one too", async () => {
    expect(promptOf(await wrapped("QUJD", "stas", "text")))
      .toContain("The one thing you don't touch is what they were born as");
  });
});
