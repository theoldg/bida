import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./dexie";
import { getDevice, setInstallNudgeCollapsed, setLeftOnList, updateDevice } from "./device";

/**
 * The device record is the smallest write in the app and the one that can
 * hang it: `device` is the only store `updateDevice` takes and every screen
 * reads it, so a copy frozen inside this put holds a lock the whole origin
 * queues behind — every store reads fine but `device`, and screens sit on
 * skeletons. So it waits for the front, like the sync commit (./visible.ts).
 */
describe("updateDevice while the app is in the background", () => {
  const show = (state: "visible" | "hidden") => {
    const page = Object.assign(new EventTarget(), { visibilityState: state });
    vi.stubGlobal("document", page);
    return page;
  };

  beforeEach(async () => { await db().device.clear(); });
  afterEach(() => vi.unstubAllGlobals());

  it("does not open the write until the page is seen again", async () => {
    show("visible");
    await getDevice();
    const page = show("hidden");

    let written = false;
    const run = updateDevice({ theme: "dark" }).then(() => { written = true; });
    await new Promise((r) => setTimeout(r, 50));
    expect(written).toBe(false);
    expect((await db().device.get("device"))?.theme).not.toBe("dark");

    page.visibilityState = "visible";
    page.dispatchEvent(new Event("visibilitychange"));
    await run;
    expect((await db().device.get("device"))?.theme).toBe("dark");
  });

  it("merges onto the record as it is when it lands, not as it was when parked", async () => {
    show("visible");
    await getDevice();
    const page = show("hidden");

    const parked = updateDevice({ theme: "dark" });
    await new Promise((r) => setTimeout(r, 50));
    // Another copy of the app sets a field this patch doesn't name; a put built
    // from the pre-park read would carry the old value back over it.
    await db().device.update("device", { lastOpenedGroupId: "marrakech" });

    page.visibilityState = "visible";
    page.dispatchEvent(new Event("visibilitychange"));
    await parked;

    const after = await db().device.get("device");
    expect(after?.theme).toBe("dark");
    expect(after?.lastOpenedGroupId).toBe("marrakech");
  });

  it("writes at once when the page is on screen", async () => {
    show("visible");
    await getDevice();
    await setLeftOnList();
    expect((await db().device.get("device"))?.leftOnList).toBe(true);
  });

  it("writes nothing at all when the value has not changed", async () => {
    show("visible");
    await setInstallNudgeCollapsed(false);
    // A no-op must stay a no-op while hidden too: the early return is what
    // keeps navigation from parking a write on every screen it passes through.
    show("hidden");
    await setInstallNudgeCollapsed(false);
    expect((await db().device.get("device"))?.installNudgeCollapsed).toBeUndefined();
  });
});
