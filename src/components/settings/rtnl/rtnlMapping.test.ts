// SPDX-License-Identifier: GPL-2.0-only
import { afterEach, expect, it, vi } from "vitest";
import { fetchRtnlMapping, parseRtnlMapping } from "./rtnlMapping";

const backend = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../../config/defaultApiConfig", () => ({
    defaultAPIConfig: () => ({ basePath: "/proxy/prefix", fetchApi: backend.fetch }),
}));
const registry = () => ({
    schemaVersion: 1,
    revision: "backend-revision",
    log2: {},
    log3: {},
    events: {},
});
afterEach(() => vi.clearAllMocks());

it("loads the registry through the authenticated API transport and runtime prefix", async () => {
    backend.fetch.mockResolvedValue(new Response(JSON.stringify(registry())));
    const abort = new AbortController();
    expect(await fetchRtnlMapping(abort.signal)).toEqual(registry());
    expect(backend.fetch).toHaveBeenCalledWith(
        "/proxy/prefix/api/rtnl/mapping",
        expect.objectContaining({ signal: abort.signal, cache: "no-cache" }),
    );
});

it("rejects unavailable or incompatible mappings instead of using a frontend dictionary", async () => {
    backend.fetch.mockResolvedValue(new Response("not available", { status: 503 }));
    await expect(fetchRtnlMapping(new AbortController().signal)).rejects.toThrow("unavailable");
    expect(() => parseRtnlMapping({ ...registry(), schemaVersion: 2 })).toThrow("Unsupported");
    expect(() =>
        parseRtnlMapping({
            ...registry(),
            log2: { "99-1": { label: { en: "Bad" }, minBytes: -1, fields: [] } },
        }),
    ).toThrow("Invalid");
    expect(() =>
        parseRtnlMapping({
            ...registry(),
            log2: {
                "99-1": {
                    label: { en: "Bad" },
                    minBytes: 0,
                    fields: [{ name: "__proto__", type: "u32le" }],
                },
            },
        }),
    ).toThrow("Invalid");
});
