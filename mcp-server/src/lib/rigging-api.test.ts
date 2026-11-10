import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// config.ts читает окружение при импорте.
process.env.MCP_API_KEY = "test-key";
process.env.WP_GRAPHQL_URL = "https://cms.example.test/graphql";
process.env.CMS_GALLERY_URL = "https://cms.example.test/gallery";
process.env.RIGGING_API_BASE_URL = "https://rigging.example.test/";
process.env.PUBLIC_SITE_URL = "https://site.example.test";

const { calculateRigging, getRiggingProfileDocument, listRiggingProfiles, RiggingApiError } =
  await import("./rigging-api.js");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const input = {
  profileId: "early_plant",
  profileVersion: null,
  scaleDenominator: 65,
  measurements: {
    mastDiameter: { main: { value: 8, unitId: "mm" as const, basis: "model" as const, measurementPointId: "unknown" as const } },
  },
  nodes: [
    {
      nodeId: "mast.main.lower",
      nodeType: "lower_mast",
      parentNodeId: null,
      ownerType: "mast" as const,
      ownerId: "main",
      present: true,
    },
  ],
};

describe("listRiggingProfiles", () => {
  it("reads the manifest from the rigging worker", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ apiVersion: "1", profiles: [{ profileId: "early_plant" }] }));

    const manifest = await listRiggingProfiles();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://rigging.example.test/api/rigging/v1/profiles");
    expect(init.method).toBe("GET");
    expect(manifest.profiles[0]?.profileId).toBe("early_plant");
  });

  it("maps 503 PROFILE_UNAVAILABLE", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "PROFILE_UNAVAILABLE", message: "Profile manifest is unavailable.", fields: [] } }, 503),
    );

    await expect(listRiggingProfiles()).rejects.toMatchObject({ code: "PROFILE_UNAVAILABLE", status: 503 });
  });
});

describe("getRiggingProfileDocument", () => {
  const document = { profile: { profileId: "early_plant", profileVersion: "1.2.2", ui: { masts: true } }, rules: [] };

  it("reads a pinned version from the website profile API", async () => {
    fetchMock.mockResolvedValue(jsonResponse(document));

    const result = await getRiggingProfileDocument("early_plant", "1.2.2");

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://site.example.test/api/rigging/profiles/early_plant/1.2.2");
    expect(result?.profile.profileVersion).toBe("1.2.2");
  });

  it("reads the latest version without a version segment", async () => {
    fetchMock.mockResolvedValue(jsonResponse(document));

    await getRiggingProfileDocument("early_plant");

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://site.example.test/api/rigging/profiles/early_plant");
  });

  it("returns null for an unknown profile", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "not found" }, 404));

    await expect(getRiggingProfileDocument("nope")).resolves.toBeNull();
  });

  it("refuses a document for another profile", async () => {
    fetchMock.mockResolvedValue(jsonResponse(document));

    await expect(getRiggingProfileDocument("traditional_plant")).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });
});

describe("calculateRigging", () => {
  it("posts the expanded input to the worker unchanged", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ apiVersion: "1", profileId: "early_plant", results: [] }));

    await calculateRigging(input);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://rigging.example.test/api/rigging/v1/calculate");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(input);
  });

  it("surfaces PROFILE_NOT_FOUND with fields", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: "PROFILE_NOT_FOUND", message: "Unknown profile: x.", fields: ["profileId"] }, requestId: "r" },
        422,
      ),
    );

    const error = await calculateRigging({ ...input, profileId: "x" }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(RiggingApiError);
    expect(error).toMatchObject({ code: "PROFILE_NOT_FOUND", status: 422, fields: ["profileId"] });
  });

  it("maps a network failure to NETWORK_ERROR", async () => {
    fetchMock.mockRejectedValue(new Error("socket hang up"));

    await expect(calculateRigging(input)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("rejects a non-JSON success response", async () => {
    fetchMock.mockResolvedValue(new Response("oops", { status: 200 }));

    await expect(calculateRigging(input)).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });
});
