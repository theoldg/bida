"use client";

import { useEffect, useRef, useState } from "react";
import { Body, Screen, Scroll, TopBar } from "@/components/chrome";
import { copy } from "@/lib/copy";
import { route } from "@/lib/group-link";
import { prepareBill, type PreparedBill } from "@/lib/scan/downscale";
import { billFinderLoadMs, warmBillFinder } from "@/lib/scan/find-bill";
import { ZoomView } from "./zoom-view";

/**
 * The scan's crop as a smoke test: pick photos, see the box the model drew on
 * each and the image a scan would send, with what every step cost. Runs the
 * real `prepareBill`, and sends nothing (docs/scan-worker.md#cropping-to-the-bill).
 */
export default function DiagCropPage() {
  const input = useRef<HTMLInputElement>(null);
  const [model, setModel] = useState<"idle" | "loading" | "failed" | number>("idle");
  const [results, setResults] = useState<Result[]>([]);
  const [working, setWorking] = useState(false);
  /** The image open over the whole screen, either side of a row. */
  const [zoomed, setZoomed] = useState<string | null>(null);

  // Object URLs outlive the screen unless given back.
  useEffect(() => () => { for (const r of results) URL.revokeObjectURL(r.url); }, [results]);

  const pick = () => {
    if (model !== "loading" && typeof model !== "number") {
      setModel("loading");
      void warmBillFinder().then((s) => setModel(s ? Math.round(billFinderLoadMs() ?? 0) : "failed"));
    }
    input.current?.click();
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setWorking(true);
    const next: Result[] = [];
    // One at a time, so each timing is the photo's own and not a share of four.
    for (const file of Array.from(files)) {
      const bill = await prepareBill(file);
      next.push({ name: file.name, bytes: file.size, url: URL.createObjectURL(file), bill });
      setResults([...next]);
    }
    setWorking(false);
  };

  return (
    <Screen>
      <Body>
        <TopBar title={copy.diag.crop.title} back={route.diag()} />
        <Scroll>
          <div className="diag-act">
            <p className="hint">{copy.diag.crop.lede}</p>
            <button type="button" className="btn btn-p" disabled={working} onClick={pick}>
              {working ? copy.diag.crop.working : copy.diag.crop.pick}
            </button>
            <input ref={input} type="file" accept="image/*" multiple style={{ display: "none" }}
              onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
            {model === "idle" ? null : (
              <p className="cropcheck-model">
                {model === "loading" ? copy.diag.crop.loading
                  : model === "failed" ? copy.diag.crop.failed
                    : copy.diag.crop.loaded(model)}
              </p>
            )}
          </div>
          {results.map((r, i) => <Row key={i} result={r} onZoom={setZoomed} />)}
          {zoomed ? <ZoomView src={zoomed} onClose={() => setZoomed(null)} /> : null}
        </Scroll>
      </Body>
    </Screen>
  );
}

interface Result { name: string; bytes: number; url: string; bill: PreparedBill }

function Row({ result: { name, bytes, url, bill }, onZoom }: {
  result: Result; onZoom: (src: string) => void;
}) {
  const sent = `data:image/jpeg;base64,${bill.base64}`;
  const { quad, box, source } = bill;
  const sentKb = Math.round((bill.base64.length * 3) / 4 / 1024);
  const pts = (ps: readonly { x: number; y: number }[]) => ps.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <div className="cropcheck">
      <div className="cropcheck-pair">
        <div className="cropcheck-src" onClick={() => onZoom(url)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL */}
          <img src={url} alt="" />
          {/* The model's corners, and the upright box the scan keeps. */}
          {quad && box ? (
            <svg viewBox={`0 0 ${source.width} ${source.height}`} aria-hidden="true">
              <polygon className="cropcheck-quad" points={pts(quad)} />
              <rect className="cropcheck-box" x={box.cx - box.width / 2} y={box.cy - box.height / 2}
                width={box.width} height={box.height}
                transform={`rotate(${degrees(box.angle)} ${box.cx} ${box.cy})`} />
            </svg>
          ) : null}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- a data URL */}
        <img className="cropcheck-out" src={sent} alt="" onClick={() => onZoom(sent)} />
      </div>
      <pre className="diag">{[
        name,
        `${source.width}×${source.height}, ${Math.round(bytes / 1024)} KB`,
        box
          ? `kept ${Math.round(box.width)}×${Math.round(box.height)}, turned ${degrees(box.angle).toFixed(1)}°`
          : copy.diag.crop.whole,
        `sent ${bill.sent.width}×${bill.sent.height}, ${sentKb} KB`,
        `find ${ms(bill.ms.find)} · turn ${ms(bill.ms.turn)} · encode ${ms(bill.ms.encode)} · total ${ms(bill.ms.total)}`,
      ].join("\n")}</pre>
    </div>
  );
}

const degrees = (rad: number) => (rad * 180) / Math.PI;
const ms = (n: number) => `${Math.round(n)} ms`;
