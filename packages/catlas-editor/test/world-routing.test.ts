import { describe, expect, test } from "vite-plus/test";
import { validWorldSlug } from "../src/lib/world-api";
import { changesetsQueryKey } from "../src/lib/query-keys";

describe("world routing helpers", () => {
  test("validates world slug boundaries", () => {
    expect(validWorldSlug("a")).toBe(true);
    expect(validWorldSlug("a".repeat(64))).toBe(true);
    expect(validWorldSlug("a".repeat(65))).toBe(false);
    expect(validWorldSlug("alpha-2")).toBe(true);
    expect(validWorldSlug("Alpha-2")).toBe(false);
    expect(validWorldSlug("alpha--2")).toBe(false);
    expect(validWorldSlug("-alpha")).toBe(false);
  });

  test("scopes changesets by world", () => {
    expect(changesetsQueryKey("alpha")).toEqual(["worlds", "alpha", "changesets"]);
    expect(changesetsQueryKey("beta")).not.toEqual(changesetsQueryKey("alpha"));
  });
});
