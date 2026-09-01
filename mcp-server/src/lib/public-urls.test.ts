import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildLogPartUrl,
  buildUrl,
  galleryUrl,
  siteOrigin,
  tutorialUrl,
} from "./public-urls.js";

describe("public URLs", () => {
  const originalSiteUrl = process.env.PUBLIC_SITE_URL;

  beforeEach(() => {
    delete process.env.PUBLIC_SITE_URL;
  });

  afterEach(() => {
    if (originalSiteUrl === undefined) {
      delete process.env.PUBLIC_SITE_URL;
    } else {
      process.env.PUBLIC_SITE_URL = originalSiteUrl;
    }
  });

  it("uses the production origin by default", () => {
    expect(siteOrigin()).toBe("https://www.glushkov-modelling.com");
  });

  it("builds the canonical build page URL", () => {
    expect(buildUrl("le-requin")).toBe(
      "https://www.glushkov-modelling.com/builds/le-requin",
    );
  });

  it("addresses a build log part with an anchor on the build page", () => {
    expect(buildLogPartUrl("le-requin", 2)).toBe(
      "https://www.glushkov-modelling.com/builds/le-requin#part-2",
    );
  });

  it("accepts a part number passed as a string", () => {
    expect(buildLogPartUrl("le-requin", "3")).toBe(
      "https://www.glushkov-modelling.com/builds/le-requin#part-3",
    );
  });

  it("falls back to the build page when the part number is unknown", () => {
    expect(buildLogPartUrl("le-requin", null)).toBe(
      "https://www.glushkov-modelling.com/builds/le-requin",
    );
    expect(buildLogPartUrl("le-requin", "")).toBe(
      "https://www.glushkov-modelling.com/builds/le-requin",
    );
  });

  it("builds tutorial and gallery URLs", () => {
    expect(tutorialUrl("planking-basics")).toBe(
      "https://www.glushkov-modelling.com/tutorials/planking-basics",
    );
    expect(galleryUrl("le-requin")).toBe(
      "https://www.glushkov-modelling.com/gallery/le-requin",
    );
  });

  it("returns null instead of guessing a URL for a missing slug", () => {
    expect(buildUrl(null)).toBeNull();
    expect(buildUrl("  ")).toBeNull();
    expect(buildLogPartUrl(null, 2)).toBeNull();
    expect(tutorialUrl(undefined)).toBeNull();
    expect(galleryUrl("")).toBeNull();
  });

  it("encodes unsafe slug characters", () => {
    expect(buildUrl("model test")).toBe(
      "https://www.glushkov-modelling.com/builds/model%20test",
    );
  });

  it("honours PUBLIC_SITE_URL for non-production environments", () => {
    process.env.PUBLIC_SITE_URL = "https://staging.glushkov-modelling.com/";
    expect(buildUrl("le-requin")).toBe(
      "https://staging.glushkov-modelling.com/builds/le-requin",
    );
  });

  it("ignores an invalid PUBLIC_SITE_URL and keeps the production origin", () => {
    process.env.PUBLIC_SITE_URL = "not a url";
    expect(siteOrigin()).toBe("https://www.glushkov-modelling.com");
  });
});
