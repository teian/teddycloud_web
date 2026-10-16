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
