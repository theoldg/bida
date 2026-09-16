import { beforeEach, describe, expect, it } from "vitest";
import { forget, format, hideSecrets, mark, started, timeline } from "./diag";

/**
 * The recorder has one job — say what the app was waiting for — and two ways
 * to fail at it silently: losing the span that never finished, and printing
 * spans in the order they *ended*, which hides the overlap that is the whole
 * answer.
 */
describe("the flight recorder", () => {
  beforeEach(forget);

  it("keeps a span that has not finished, and says so", () => {
    started("rebuild", "200 ops");
    const [only, ...rest] = timeline();
    expect(rest).toEqual([]);
    expect(only?.what).toBe("rebuild");
    expect(only?.info).toContain("STILL RUNNING");
    // A read hanging right now is the reason the screen is open. It must have
    // a duration, not sit there as a nameless gap.
    expect(typeof only?.ms).toBe("number");
  });

  it("replaces the running line with the finished one", () => {
    const done = started("rebuild");
    done("200 ops");
    const [only] = timeline();
    expect(timeline()).toHaveLength(1);
    expect(only?.info).toBe("200 ops");
    expect(only?.info).not.toContain("STILL RUNNING");
  });

  it("ignores a second call to the same done()", () => {
    const done = started("sync.pushpull");
    done("0 up, 3 down");
    done("again");
    expect(timeline()).toHaveLength(1);
    expect(timeline()[0]?.info).toBe("0 up, 3 down");
  });

  /**
   * The point of the whole file. A long `rebuild` that starts first and ends
   * last must print *before* the read it was blocking, or the report says the
   * read was slow rather than that it was waiting.
   */
  it("orders by when things started, not when they ended", () => {
    const slow = started("rebuild");
    const quick = started("live");
    quick("groupSummaries 3 rows");
    slow("2000 ops");

    expect(timeline().map((e) => e.what)).toEqual(["rebuild", "live"]);
  });

  it("prints a line that can be read on a phone", () => {
    mark("db.new");
    const out = format(timeline());
    expect(out).toContain("db.new");
    expect(out.split("\n")).toHaveLength(1);
  });

  it("keeps the newest when it runs past its limit", () => {
    for (let i = 0; i < 450; i++) mark("tick", String(i));
    const rows = timeline();
    expect(rows.length).toBeLessThanOrEqual(400);
    expect(rows.at(-1)?.info).toBe("449");
  });
});

describe("hideSecrets", () => {
  it("masks every secret in a fragment and keeps the ids", () => {
    expect(hideSecrets("https://x.app/install#abc.s3cr-t_1~def.other"))
      .toBe("https://x.app/install#abc.…~def.…");
  });

  it("leaves a dotted host and path alone", () => {
    expect(hideSecrets("https://bida.app/g?id=a.b")).toBe("https://bida.app/g?id=a.b");
  });
});
