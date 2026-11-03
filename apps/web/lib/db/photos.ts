"use client";
// Doc: docs/photos.md

import { useEffect, useMemo } from "react";
import type { Id } from "@bida/core";
import { db } from "./dexie";
import { useLive } from "./live";
import { fetchPhoto } from "./sync";

const DATA_URL = "data:image/jpeg;base64,";

export function photoUrl(jpeg: string): string {
  return DATA_URL + jpeg;
}

/** The scan's data URL as the base64 and size the attachment keeps. */
export function keptJpeg(dataUrl: string): { jpeg: string; bytes: number } {
  const jpeg = dataUrl.startsWith(DATA_URL) ? dataUrl.slice(DATA_URL.length) : dataUrl;
  const pad = jpeg.endsWith("==") ? 2 : jpeg.endsWith("=") ? 1 : 0;
  return { jpeg, bytes: Math.floor((jpeg.length * 3) / 4) - pad };
}

/** What a screen draws for a kept photo: the photo, or a frame it will arrive in. */
export interface ShownPhoto {
  src?: string;
}

/**
 * The entry's kept photo, from this phone if it has it, else fetched once and
 * kept (`fetchPhoto`). Undefined is no photo, or one since dropped.
 */
export function usePhoto(groupId: Id | undefined, attachmentId: Id | undefined): ShownPhoto | undefined {
  const row = useLive("photo", async () => {
    if (!groupId || !attachmentId) return null;
    const d = db();
    const [attachment, photo] = await Promise.all([d.attachments.get(attachmentId), d.photos.get(attachmentId)]);
    if (!attachment || attachment.deletedAt || photo?.state === "delete") return null;
    return { jpeg: photo?.jpeg ?? null };
  }, [groupId, attachmentId]);

  const missing = !!row && !row.jpeg;
  useEffect(() => {
    if (missing && groupId && attachmentId) void fetchPhoto(groupId, attachmentId);
  }, [missing, groupId, attachmentId]);

  const present = !!row;
  const jpeg = row?.jpeg;
  return useMemo(() => (present ? { src: jpeg ? photoUrl(jpeg) : undefined } : undefined), [present, jpeg]);
}
