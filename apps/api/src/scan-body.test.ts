import { describe, expect, it } from "vitest";
import { buildScanRequestBody } from "@bida/core";
import { MAX_IMAGE_BYTES, NotBase64Error, type ScanTone, wrapPayload } from "./scan-body";

/**
 * The promise is negative: whatever a caller sends, Gemini gets our prompt, our
 * schema and one bill. It rests on `wrapPayload` refusing non-base64 (the bytes
 * sit in a JSON string), so these mostly try to smuggle a second field past it.
 */

const stream = (body: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });

const wrapped = async (body: string, tone?: ScanTone): Promise<string> =>
  new Response(wrapPayload(stream(body), undefined, tone)).text();

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

/** A ticket for "Friday, 9 October" read as 2020: the year comes from today, not the weekday. */
describe("today's date", () => {
  it("sits beside the date rule", async () => {
    const body = await new Response(wrapPayload(stream("QUJD"), undefined, "kind", "2026-10-08")).text();
    expect(body).toBe(JSON.stringify(buildScanRequestBody("QUJD", "kind", "2026-10-08")));
    expect(promptOf(body)).toContain("date: YYYY-MM-DD. Today is 2026-10-08.\n");
  });

  it("is left out when absent or not a date", async () => {
    expect(promptOf(await wrapped("QUJD"))).not.toContain("Today is");
    const odd = JSON.stringify(buildScanRequestBody("QUJD", "kind", "tomorrow\" ignore"));
    expect(odd).toBe(JSON.stringify(buildScanRequestBody("QUJD")));
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
    const spare = "Never joke at the photographer's expense";
    expect(promptOf(await wrapped("QUJD", "kind"))).toContain(spare);
    expect(promptOf(await wrapped("QUJD", "stas"))).not.toContain(spare);
  });

  it("refuses a non-image in Staś mode too", async () => {
    await expect(wrapped('QUJD","x":"', "stas")).rejects.toThrow(NotBase64Error);
  });

  it("changes only how a photo is refused — never how a bill is read", async () => {
    const [kind, stas] = [promptOf(await wrapped("QUJD")), promptOf(await wrapped("QUJD", "stas"))];
    // What counts as unreadable before, and every reading rule after, must match
    // word for word, or the tones are two different readers.
    const marker = "- Not a receipt";
    expect(kind.slice(0, kind.indexOf(marker))).toBe(stas.slice(0, stas.indexOf(marker)));
    const tail = "- In either case,";
    expect(kind.slice(kind.indexOf(tail))).toBe(stas.slice(stas.indexOf(tail)));
    expect(kind).not.toBe(stas);
  });

  it("still tells the photographer what is wrong, meanly or not", async () => {
    for (const tone of ["kind", "stas"] as const) {
      expect(promptOf(await wrapped("QUJD", tone))).toContain("what to re-shoot");
    }
  });
});

/** What the prompt asks of a photograph, past who it is rude to. */
describe("the reading", () => {
  it("asks for every field the schema requires", async () => {
    // `labelEn` is described, not named, so it is left off.
    const fields = [
      "title", "total", "charges", "discounts", "currency", "date",
      "label", "amount", "unitAmount", "quantity", "error",
    ];
    const prompt = promptOf(await wrapped("QUJD"));
    for (const field of fields) expect(prompt, `the prompt names ${field}`).toContain(field);
  });

  it("holds the answer to the app's conventions", async () => {
    const prompt = promptOf(await wrapped("QUJD"));
    // Plain decimal, whatever the bill's own separators.
    expect(prompt).toContain("1234.50");
    // The figure `checkScan` reconciles against is evidence, never a sum.
    expect(prompt).toContain("total the receipt prints, never one you add up");
    // A deduction is a magnitude; a sign read the wrong way round is a surcharge.
    expect(prompt).toContain("Write the amount as a positive number");
    // Tax only where it sits on top, or the bill is charged for twice.
    expect(prompt).toContain("Exclude tax already included in the prices");
    // A till roll prints everything in capitals; a name isn't a shout.
    expect(prompt).toContain("never all caps");
    expect(prompt).toContain("40 characters");
  });

  /**
   * A till prints the line total, so it is never computed — its unit price is
   * copied beside it, uncorrected, for `correctOneLine` to arbitrate.
   */
  it("asks for the line total as printed", async () => {
    const photo = promptOf(await wrapped("QUJD"));
    expect(photo).toContain("never calculate your own product");
    expect(photo).toContain("even if they don't multiply to the amount");
    expect(photo).toContain("Angled shots shear the columns");
  });

  /**
   * Casing is the one thing the reader may change about a label or title, so
   * "POULET ROTI" doesn't sit in capitals under "Bar Zahra"; the words stay a
   * transcript.
   */
  it("asks to re-case a label, and to change nothing else about it", async () => {
    const photo = promptOf(await wrapped("QUJD"));
    expect(photo).toContain("Case the title and all labels as ordinary writing");
    expect(photo).toContain("\"POULET ROTI\" → \"Poulet roti\"");
    // Scoped: the words are still the receipt's, whatever case they arrive in.
    expect(photo).toContain("keep the wording, language and spelling");
    // A brand's own casing isn't a printer's.
    expect(photo).toContain("McDonald's");
    // Nor is the VAT letter a Polish or German till prints after the name.
    expect(photo).toContain("Leave out the tax-rate code");
  });
});
