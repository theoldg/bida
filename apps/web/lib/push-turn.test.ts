import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "./db/dexie";
import { createGroup } from "./db/commands";
import { getDevice } from "./db/device";
import { reconcilePush, setNotifyLevel } from "./push";

/**
 * Two writers of this phone's push state, one behind the other (lib/push.ts):
 * a start's reconcile waits on the network between reading the level and
 * writing it, and a Settings tap can land in that wait.
 */
describe("push state changes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("never writes a level read before a Settings tap over the one it chose", async () => {
    const { groupId } = await createGroup({ name: "Marrakech", baseCurrency: "EUR", myName: "Theo" });
    const sub = {
      options: { applicationServerKey: null },
      toJSON: () => ({ endpoint: "https://push.example/a", keys: { p256dh: "BPk", auth: "au" } }),
    };
    vi.stubGlobal("window", { PushManager: class {}, Notification: {} });
    vi.stubGlobal("Notification", { permission: "granted" });
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => sub } }) },
    });
    // The first ask for the key hangs until released: the reconcile, parked.
    let release!: () => void;
    const first = new Promise<void>((ok) => { release = ok; });
    let asks = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (asks++ === 0) await first;
      return new Response(JSON.stringify({}));
    }));

    const reconciling = reconcilePush();
    await vi.waitFor(() => expect(asks).toBe(1));
    const tapped = setNotifyLevel("all");
    // The tap's own ask answers at once, so left alone it writes first — and
    // the reconcile, released after, writes what it read before the tap.
    expect(await tapped).toBe(true);
    release();
    await reconciling;

    const device = await getDevice();
    expect(device.notify).toBe("all");
    await vi.waitFor(async () => {
      const mine = await db().identities.get([groupId, device.nodeId]);
      expect(mine?.push?.scope).toBe("all");
    });
  });

  it("keeps a tap's level at once, whatever the browser does after", async () => {
    await createGroup({ name: "Marrakech", baseCurrency: "EUR", myName: "Theo" });
    vi.stubGlobal("window", { PushManager: class {}, Notification: {} });
    vi.stubGlobal("Notification", { permission: "granted" });
    // The iOS Simulator: its push manager never answers.
    let asks = 0;
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: async () => ({ pushManager: { getSubscription: () => { asks++; return new Promise(() => {}); } } }),
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}))));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      expect(await setNotifyLevel("own")).toBe(true);
      await vi.waitFor(() => expect(asks).toBe(1));
      // Three taps behind the hung call: each kept at once, one reconcile for all.
      for (const level of ["all", "off", "all"] as const) expect(await setNotifyLevel(level)).toBe(true);
      expect((await getDevice()).notify).toBe("all");
      await vi.advanceTimersByTimeAsync(10_000);
      await vi.waitFor(() => expect(asks).toBe(2));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(asks).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
