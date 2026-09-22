import { describe, expect, it } from "vitest";
import { buildScanRequestBody } from "@bida/core";
import {
  MAX_IMAGE_BYTES, MAX_TEXT_BYTES, NotBase64Error,
  type ScanMedium, type ScanTone, wrapPayload,
} from "./scan-body";

/**
 * The promise is negative: whatever a caller sends, Gemini gets our prompt, our
 * schema and one bill. It rests on `wrapPayload` refusing non-base64 (the bytes
 * sit in a JSON string), so these mostly try to smuggle a second field past it.
 * Typed bills are base64 for the same reason.
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
  // A quote closes the JSON string, and whatever follows is caller-written request.
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

  // Text has its own, far lower cap; it can't spend the image allowance.
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
 * Staś mode moves one paragraph and nothing else — a mean refusal is a joke, a
 * differently-read receipt is a wrong bill. The header picks one of our
 * envelopes; nothing reaches caller hands.
 */
describe("the two tones", () => {
  it("is the kind one when nobody asks", async () => {
    expect(await wrapped("QUJD")).toBe(await wrapped("QUJD", "kind"));
  });

  it("carries the image untouched either way", async () => {
    expect(await wrapped("QUJD", "stas")).toBe(JSON.stringify(buildScanRequestBody("QUJD", "stas")));
  });

  // The one sentence the tones contradict: Staś mode is at the photographer's expense.
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
    // Reading instructions before and cropped-receipt rule after must match word
    // for word, or the tones are two different readers.
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
 * The media may differ in attachment, layout advice and refusal only — or a
 * split would price differently depending on whether anybody had a camera.
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
   * The prompts are separate documents, so instead of a shared block this checks
   * one answer shape and the conventions both must agree on.
   */
  it("asks both media for every field the schema requires", async () => {
    // `labelEn` is described, not named, in the photo prompt, so it is left off.
    const fields = [
      "title", "total", "tip", "tax", "discounts", "currency", "date",
      "label", "amount", "unitAmount", "quantity", "error",
    ];
    for (const medium of ["photo", "text"] as const) {
      const prompt = promptOf(await wrapped("QUJD", "kind", medium));
      for (const field of fields) {
        expect(prompt, `the ${medium} prompt names ${field}`).toContain(field);
      }
    }
  });

  it("holds both media to the same conventions about the answer", async () => {
    for (const medium of ["photo", "text"] as const) {
      const prompt = promptOf(await wrapped("QUJD", "kind", medium));
      // Plain decimal, whatever the bill's own separators.
      expect(prompt).toContain("1234.50");
      // A deduction is a magnitude; a sign read the wrong way round is a surcharge.
      expect(prompt).toContain("WITHOUT a minus sign");
      // Tax only where it sits on top, or the bill is charged for twice.
      expect(prompt).toContain("charged for twice");
      // A till roll prints everything in capitals; a name isn't a shout.
      expect(prompt).toContain("all capitals");
      expect(prompt).toContain("40 characters");
    }
  });

  /** Tone moves the refusal only, so a mean scan can't be a wrong one. */
  it.each([
    ["photo", "If the photo isn't a receipt at"],
    ["text", "If the text is not a bill at all"],
  ])("reads a %s by rules no tone can move", async (medium, marker) => {
    const [kind, stas] = await Promise.all((["kind", "stas"] as const)
      .map(async (tone) => promptOf(await wrapped("QUJD", tone, medium as ScanMedium))));
    expect(kind!.indexOf(marker)).toBeGreaterThan(-1);
    expect(kind!.slice(0, kind!.indexOf(marker))).toBe(stas!.slice(0, stas!.indexOf(marker)));
    expect(kind).not.toBe(stas);
  });

  /**
   * A till prints the line total, so a photo's is never computed; a typist writes
   * the unit price and the total exists nowhere (`lineMinor`).
   */
  it("asks a photograph for the line total and a typed bill for either figure", async () => {
    const photo = promptOf(await wrapped("QUJD", "kind", "photo"));
    expect(photo).toContain("never a product you work out yourself");
    expect(photo).toContain("Leave unitAmount null on every line");

    const text = promptOf(await wrapped("QUJD", "kind", "text"));
    expect(text).toContain("Do not multiply and do not divide");
    expect(text).toContain("put that price in unitAmount and leave amount null");
    expect(text).not.toContain("never a product you work out yourself");
  });

  /** A typed bill usually has no total, and that is not a fault to be refused. */
  it("tells a typed bill's reader that a missing total is ordinary", async () => {
    for (const tone of ["kind", "stas"] as const) {
      const prompt = promptOf(await wrapped("QUJD", tone, "text"));
      expect(prompt).toContain("never add the bill up yourself");
      expect(prompt).toContain("never a reason to refuse a bill");
      // Repeated in the refusal paragraph, where it would bite.
      expect(prompt.slice(prompt.indexOf("If the text is not a bill at all")))
        .toContain("A bill with no total is none of these cases");
    }
  });

  /** Almost never a title: a description of the list is not a name. */
  it("asks a typed bill for a title only where one is named", async () => {
    const text = promptOf(await wrapped("QUJD", "kind", "text"));
    expect(text).toContain("Otherwise return null, which will usually be the answer");
    expect(text).not.toContain("add two or three English words for what was bought");
  });

  it("never asks a typed bill to be re-shot", async () => {
    for (const tone of ["kind", "stas"] as const) {
      // Only the refusal: the lead says "not photographed" on purpose.
      const prompt = promptOf(await wrapped("QUJD", tone, "text"));
      const refusal = prompt.slice(prompt.indexOf("If the text is not a bill at all"));
      expect(refusal).not.toContain("re-shoot");
      expect(refusal).not.toContain("blurry");
      expect(refusal).not.toContain("photo");
      // A refusal's job is to say what is missing.
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

  /** The one field a typed bill's reader may improve, scoped tight. */
  /**
   * Casing is the one thing a photo's reader may change about a label or title,
   * so "POULET ROTI" doesn't sit in capitals under "Bar Zahra"; the words stay a
   * transcript.
   */
  it("asks a photograph to re-case a label, and to change nothing else about it", async () => {
    const photo = promptOf(await wrapped("QUJD", "kind", "photo"));
    expect(photo).toContain("Case the title and every label as ordinary writing");
    expect(photo).toContain("\"POULET ROTI\" is \"Poulet roti\"");
    // Scoped: the words are still the receipt's, whatever case they arrive in.
    expect(photo).toContain("their language and their spelling stay");
    // A brand's own casing isn't a printer's.
    expect(photo).toContain("lululemon");
  });

  it("asks a typed bill to clean up a label but never invent one", async () => {
    const text = promptOf(await wrapped("QUJD", "kind", "text"));
    expect(text).toContain("Fill in a word another line makes plain but this one dropped");
    expect(text).toContain("name the brand instead of the genre");
    expect(text).toContain("never invent a dish, a brand or a detail the line gives no reason to pick");

    const photo = promptOf(await wrapped("QUJD", "kind", "photo"));
    expect(photo).not.toContain("name the brand instead of the genre");
  });
});
