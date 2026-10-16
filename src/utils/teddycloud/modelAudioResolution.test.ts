// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), library: vi.fn() }));
vi.mock("../../api", () => ({
    TeddyCloudApi: class {
        apiGetTeddyCloudApiRaw = mocks.request;
    },
}));
vi.mock("../../config/defaultApiConfig", () => ({ defaultAPIConfig: () => ({}) }));
vi.mock("./fetchTAFsInLibrary", () => ({ fetchAllTAFsInLibrary: mocks.library }));
import { resolveModelAudioTarget } from "./modelAudioResolution";
beforeEach(() => vi.clearAllMocks());
const catalog = [{ model: "TEST-001", audio_id: ["10", "20"], hash: ["old", "ABC"] }];
function configure(files: unknown[]) {
    mocks.request.mockImplementation(
        async (path: string) =>
            new Response(JSON.stringify(path.includes("Custom") ? [] : catalog)),
    );
    mocks.library.mockResolvedValue(files);
}
it("assigns an available later audio revision from the selected box library", async () => {
    configure([
        {
            name: "second.taf",
            fullPath: "Series/second.taf",
            isDir: false,
            tafHeader: { audioId: 20, sha1Hash: "abc" },
        },
    ]);
    await expect(resolveModelAudioTarget("test-001", "001122334455")).resolves.toEqual({
        hasMapping: true,
        path: "lib://Series/second.taf",
    });
    expect(mocks.library).toHaveBeenCalledWith({ overlay: "001122334455" });
    expect(mocks.request).toHaveBeenCalledWith("/api/toniesJson", "001122334455");
});
it("keeps model assignment available without matching audio and rejects mismatched pairs", async () => {
    configure([
        {
            name: "wrong.taf",
            fullPath: "wrong.taf",
            isDir: false,
            tafHeader: { audioId: 10, sha1Hash: "abc" },
        },
    ]);
    await expect(resolveModelAudioTarget("TEST-001", "box")).resolves.toEqual({
        hasMapping: true,
        path: null,
    });
});
it("does not invent an audio assignment for metadata-only entries", async () => {
    mocks.request.mockResolvedValue(new Response(JSON.stringify([{ model: "META" }])));
    // Each request must receive its own unread response body.
    mocks.request.mockImplementation(async () => new Response(JSON.stringify([{ model: "META" }])));
    await expect(resolveModelAudioTarget("META", "box")).resolves.toEqual({
        hasMapping: false,
        path: null,
    });
    expect(mocks.library).not.toHaveBeenCalled();
});
