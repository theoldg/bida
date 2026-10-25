import { describe, expect, it } from "vitest";
import { unmangledLink } from "./failed-link";

describe("an address whose # was percent-encoded", () => {
  it("is the link it was, fragment and all", () => {
    expect(unmangledLink("/split%23vxjezg2f5z0vkdl5")).toBe("/split#vxjezg2f5z0vkdl5");
    expect(unmangledLink("/join%23g1.s3cr3t")).toBe("/join#g1.s3cr3t");
  });

  it("is nothing to repair without one", () => {
    for (const path of ["/split", "/nope", "/a%20b", "/split%2"]) expect(unmangledLink(path)).toBeNull();
  });

  it("is nothing to repair when it won't decode", () => {
    expect(unmangledLink("/split%23%E0%A4%A")).toBeNull();
  });
});
