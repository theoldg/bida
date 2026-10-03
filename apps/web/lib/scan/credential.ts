"use client";

import { useEffect, useMemo, useState } from "react";
import { isDemo, newGroupId, newGroupSecret } from "@bida/core";
import { getDevice, updateDevice } from "../db/device";
import { useGroupSecret } from "../hooks";
import { groupToken } from "../seal";

/**
 * What this phone scans with outside a group — a quick split — or in the demo,
 * which the server has never heard of
 * ([sync.md](../../../../docs/sync.md#the-demo-group-has-no-key)).
 *
 * The scan endpoint authenticates a bearer against a D1 row and refuses
 * unknown ids (or it would be an open proxy to our Gemini key), so this is a
 * credential shaped like a group's. One per *phone*, not per split: a stable
 * caller is what throttling counts, and one per bill would be a row per photo.
 */
interface ScanCredential {
  id: string;
  secret: string;
}

/**
 * A credential plus whatever must happen before the first photo — introducing
 * it to the server. What every scan is sent under.
 */
export interface ScanAs extends ScanCredential {
  /** Run once the photo is in hand and before anything is sent. Never throws. */
  prepare?: () => Promise<void>;
}

/** Read this phone's scan credential, minting one the first time. */
async function scanCredential(): Promise<ScanCredential> {
  const device = await getDevice();
  if (device.scan) return device.scan;
  const scan = { id: newGroupId(), secret: newGroupSecret() };
  await updateDevice({ scan });
  return scan;
}

/**
 * The credential, once Dexie has answered. `when` false on a screen that won't
 * scan with it: reading it mints it.
 */
export function useScanCredential(when = true): ScanCredential | undefined {
  const [cred, setCred] = useState<ScanCredential>();
  useEffect(() => {
    if (!when) return;
    let live = true;
    void scanCredential().then((c) => { if (live) setCred(c); });
    return () => { live = false; };
  }, [when]);
  return cred;
}

/**
 * Introduce the credential to the server so the scan endpoint knows the id —
 * the ops endpoint's first-sight registration (`ensureGroup`) with no ops.
 * **No op is ever pushed under it**, so the server learns less than about a
 * group.
 *
 * **Run before every scan, never once and remembered**: it is cheap, and it
 * is the only version that survives the row going missing — otherwise the
 * phone could never scan again, with nothing saying why.
 *
 * Never throws: an unreachable server fails the scan with a better sentence.
 */
export async function registerScanCredential(cred: ScanCredential): Promise<void> {
  try {
    await fetch(`/api/groups/${encodeURIComponent(cred.id)}/ops`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await groupToken(cred.id, cred.secret)}`,
      },
      body: JSON.stringify({ ops: [], since: 0 }),
    });
  } catch { /* the scan is about to say so, in words about the network */ }
}

/**
 * What a scan inside a group is sent under: usually the group's id and
 * derived bearer. **The demo is the exception** — no key, and its id must
 * never reach the server — so it scans on this phone's own credential
 * ([sync.md](../../../../docs/sync.md#the-demo-group-has-no-key)).
 *
 * Undefined until there is something to scan with, which disables the camera
 * rather than failing at the shutter.
 */
export function useScanAs(groupId: string | undefined): ScanAs | undefined {
  const demo = isDemo(groupId);
  const secret = useGroupSecret(demo ? undefined : groupId);
  const cred = useScanCredential(demo);
  return useMemo(() => {
    if (demo) {
      return cred && { ...cred, prepare: () => registerScanCredential(cred) };
    }
    return groupId && secret ? { id: groupId, secret } : undefined;
  }, [demo, cred, groupId, secret]);
}
