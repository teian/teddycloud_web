// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("../../../../api", () => ({
    TeddyCloudApi: class {
        apiGetTeddyCloudApiRaw = request;
    },
}));
vi.mock("../../../../config/defaultApiConfig", () => ({ defaultAPIConfig: () => ({}) }));
import { useTonieCardActions } from "./useTonieCardActions";
import type { TonieCardProps } from "../../../../types/tonieTypes";
beforeEach(() => vi.clearAllMocks());
for (const [status, body] of [
    [403, "Forbidden"],
    [502, "Bad gateway"],
    [200, ""],
] as const) {
    it(`reports failed or empty cloud downloads (${status}) without success notifications`, async () => {
        request.mockResolvedValue(new Response(body, { status }));
        const notify = vi.fn();
        const refresh = vi.fn();
        const close = vi.fn();
        const actions = useTonieCardActions({
            tonieCard: {
                ruid: "11000000500304e0",
                downloadTriggerUrl: "/content/download/11000000/500304E0?overlay=box",
            } as TonieCardProps,
            overlay: "box",
            modelTitle: "Test",
            t: (key) => key,
            addNotification: notify,
            addLoadingNotification: vi.fn(),
            closeLoadingNotification: close,
            fetchUpdatedTonieCard: refresh,
        });
        await actions.handleBackgroundDownload();
        expect(notify).toHaveBeenCalledWith(
            "error",
            "tonies.messages.errorDuringDownload",
            expect.any(String),
            "tonies.title",
        );
        expect(notify).toHaveBeenCalledTimes(1);
        expect(refresh).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledTimes(1);
    });
}

it("includes the actual HTTP status when the API client rejects the download", async () => {
    const { ResponseError } = await import("../../../../api/runtime");
    request.mockRejectedValue(
        new ResponseError(new Response("", { status: 410 }), "Response returned an error code"),
    );
    const notify = vi.fn();
    const actions = useTonieCardActions({
        tonieCard: {
            ruid: "97763c1a500304e0",
            downloadTriggerUrl: "/content/download/97763C1A/500304E0?overlay=box",
        } as TonieCardProps,
        overlay: "box",
        modelTitle: "Test",
        t: (key) => key,
        addNotification: notify,
        addLoadingNotification: vi.fn(),
        closeLoadingNotification: vi.fn(),
        fetchUpdatedTonieCard: vi.fn(),
    });
    await actions.handleBackgroundDownload();
    expect(notify).toHaveBeenCalledWith(
        "error",
        "tonies.messages.errorDuringDownload",
        expect.stringContaining("HTTP 410"),
        "tonies.title",
    );
});
