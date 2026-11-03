import { describe, expect, it } from "vitest";
import { fakeD1 } from "./d1.test-helper";
import {
  GROUP_PHOTO_BYTES, commitPhoto, deleteGroupPhotos, deletePhoto, isPhotoId, photoKey, reservePhoto,
  type PhotoBudget,
} from "./photos";

/**
 * The budget is the only thing between a public link and an R2 bill
 * (docs/photos.md): every ceiling refuses before the bucket is touched, and
 * every byte handed back is one that was booked.
 */

const G = "group-1";
const P1 = "0b9a4c1e-2f3d-4a5b-8c6d-7e8f9a0b1c2d";
const P2 = "1b9a4c1e-2f3d-4a5b-8c6d-7e8f9a0b1c2d";
const P3 = "2b9a4c1e-2f3d-4a5b-8c6d-7e8f9a0b1c2d";
const NOW = Date.UTC(2026, 10, 3);
const ROOMY: PhotoBudget = { stored: 1_000_000, writes: 100 };

function stored(db: D1Database): Promise<number> {
  return db.prepare("SELECT value FROM photo_usage WHERE key = 'stored'").first<{ value: number }>()
    .then((r) => r?.value ?? 0);
}

/** The slice of R2 the store calls: delete, of one key or many. */
function fakeBucket() {
  const keys = new Set<string>();
  const bucket = {
    delete: async (k: string | string[]) => { for (const key of [k].flat()) keys.delete(key); },
  } as unknown as R2Bucket;
  return { bucket, keys };
}

describe("isPhotoId", () => {
  it("takes newId()'s shape and nothing that could walk the bucket", () => {
    expect(isPhotoId(P1)).toBe(true);
    expect(isPhotoId("../other-group/x")).toBe(false);
    expect(isPhotoId(`${P1}/x`)).toBe(false);
    expect(isPhotoId(P1.toUpperCase())).toBe(false);
  });
});

describe("reservePhoto", () => {
  it("books the bytes and the month's write, and a retry spends nothing", async () => {
    const db = fakeD1();
    expect(await reservePhoto(db, G, P1, 1000, ROOMY, NOW)).toBe("reserved");
    await commitPhoto(db, G, P1, 1000, NOW);
    expect(await stored(db)).toBe(1000);
    expect(await reservePhoto(db, G, P1, 1000, ROOMY, NOW)).toBe("held");
    expect(await stored(db)).toBe(1000);
  });

  it("refuses past the stored ceiling, exactly at it", async () => {
    const db = fakeD1();
    const budget = { stored: 2500, writes: 100 };
    expect(await reservePhoto(db, G, P1, 2000, budget, NOW)).toBe("reserved");
    expect(await reservePhoto(db, G, P2, 501, budget, NOW)).toBe("storage full");
    expect(await reservePhoto(db, G, P2, 500, budget, NOW)).toBe("reserved");
    expect(await stored(db)).toBe(2500);
    // A first photo larger than the whole budget is refused too.
    expect(await reservePhoto(fakeD1(), G, P1, 2501, budget, NOW)).toBe("storage full");
  });

  it("refuses past the month's writes and hands the bytes back", async () => {
    const db = fakeD1();
    const budget = { stored: 1_000_000, writes: 2 };
    expect(await reservePhoto(db, G, P1, 10, budget, NOW)).toBe("reserved");
    expect(await reservePhoto(db, G, P2, 10, budget, NOW)).toBe("reserved");
    expect(await reservePhoto(db, G, P3, 10, budget, NOW)).toBe("month spent");
    expect(await stored(db)).toBe(20);
    // A new month, a new count.
    expect(await reservePhoto(db, G, P3, 10, budget, Date.UTC(2026, 11, 1))).toBe("reserved");
  });

  it("keeps one group from filling everybody's room", async () => {
    const db = fakeD1();
    const budget = { stored: GROUP_PHOTO_BYTES * 10, writes: 100 };
    expect(await reservePhoto(db, G, P1, GROUP_PHOTO_BYTES - 5, budget, NOW)).toBe("reserved");
    await commitPhoto(db, G, P1, GROUP_PHOTO_BYTES - 5, NOW);
    expect(await reservePhoto(db, G, P2, 6, budget, NOW)).toBe("group full");
    expect(await reservePhoto(db, "group-2", P2, 6, budget, NOW)).toBe("reserved");
  });
});

describe("commitPhoto", () => {
  it("hands back a twin upload's booking: one object, counted once", async () => {
    const db = fakeD1();
    expect(await reservePhoto(db, G, P1, 700, ROOMY, NOW)).toBe("reserved");
    expect(await reservePhoto(db, G, P1, 700, ROOMY, NOW)).toBe("reserved");
    await commitPhoto(db, G, P1, 700, NOW);
    await commitPhoto(db, G, P1, 700, NOW);
    expect(await stored(db)).toBe(700);
  });
});

describe("deletePhoto / deleteGroupPhotos", () => {
  it("removes the object and gives its room back, twice harmlessly", async () => {
    const db = fakeD1();
    const { bucket, keys } = fakeBucket();
    await reservePhoto(db, G, P1, 900, ROOMY, NOW);
    await commitPhoto(db, G, P1, 900, NOW);
    keys.add(photoKey(G, P1));
    await deletePhoto(db, bucket, G, P1);
    await deletePhoto(db, bucket, G, P1);
    expect(keys.size).toBe(0);
    expect(await stored(db)).toBe(0);
  });

  it("takes a deleted group's photos with it, and only its", async () => {
    const db = fakeD1();
    const { bucket, keys } = fakeBucket();
    for (const [g, p] of [[G, P1], [G, P2], ["group-2", P3]] as const) {
      await reservePhoto(db, g, p, 100, ROOMY, NOW);
      await commitPhoto(db, g, p, 100, NOW);
      keys.add(photoKey(g, p));
    }
    await deleteGroupPhotos(db, bucket, G);
    expect([...keys]).toEqual([photoKey("group-2", P3)]);
    expect(await stored(db)).toBe(100);
  });

  it("keeps the index when there is no bucket to delete from", async () => {
    const db = fakeD1();
    await reservePhoto(db, G, P1, 100, ROOMY, NOW);
    await commitPhoto(db, G, P1, 100, NOW);
    await deleteGroupPhotos(db, undefined, G);
    expect(await stored(db)).toBe(100);
    expect(await reservePhoto(db, G, P1, 100, ROOMY, NOW)).toBe("held");
  });
});
