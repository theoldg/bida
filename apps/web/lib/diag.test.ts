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

  /**
   * The report is hundreds of lines and a phone pastes the top of it, so the
   * line somebody is being asked about has to be in the part that survives.
   * The model still orders by when things started — only the printing is
   * turned round.
   */
  it("prints newest first, while the timeline still starts at the start", () => {
    mark("first");
    mark("second");
    mark("third");
    expect(timeline().map((e) => e.what)).toEqual(["first", "second", "third"]);
    expect(format().split("\n").map((l) => l.trim().split(/\s+/)[1]))
      .toEqual(["third", "second", "first"]);
  });

  it("does not reorder the rows it was handed", () => {
    mark("first");
    mark("second");
    const rows = timeline();
    format(rows);
    expect(rows.map((e) => e.what)).toEqual(["first", "second"]);
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
