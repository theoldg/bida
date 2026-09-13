import { beforeEach, describe, expect, it } from "vitest";
import { forgetScrolls, recallScroll, rememberScroll, restoreStep } from "./scroll-memory";

beforeEach(forgetScrolls);

describe("what the app remembers about a screen", () => {
  it("is nothing, for a screen never scrolled", () => {
    expect(recallScroll("/g?id=abc")).toBe(0);
  });

  it("is per route, so two groups don't share an offset", () => {
    rememberScroll("/g?id=abc", 420);
    rememberScroll("/g?id=def", 90);
    expect(recallScroll("/g?id=abc")).toBe(420);
    expect(recallScroll("/g?id=def")).toBe(90);
  });

  it("keeps the latest, including a scroll back to the top", () => {
    rememberScroll("/g?id=abc", 420);
    rememberScroll("/g?id=abc", 0);
    expect(recallScroll("/g?id=abc")).toBe(0);
  });
});

describe("putting a screen back where it was", () => {
  it("lands in one step once the list is tall enough", () => {
    expect(restoreStep(420, 900)).toEqual({ top: 420, done: true });
  });

  it("lands exactly at the bottom of a list that just reaches", () => {
    expect(restoreStep(420, 420)).toEqual({ top: 420, done: true });
  });

  it("is finished immediately for a screen that was at the top", () => {
    expect(restoreStep(0, 0)).toEqual({ top: 0, done: true });
  });

  it("follows the content down while the rows are still arriving", () => {
    // The frame draws before Dexie answers, so the first attempts have almost
    // nothing to scroll. Each one goes as far as it can and stays unfinished.
    expect(restoreStep(420, 0)).toEqual({ top: 0, done: false });
    expect(restoreStep(420, 120)).toEqual({ top: 120, done: false });
    expect(restoreStep(420, 999)).toEqual({ top: 420, done: true });
  });

  it("never asks for a negative offset from a list shorter than its frame", () => {
    expect(restoreStep(420, -300)).toEqual({ top: 0, done: false });
  });
});
