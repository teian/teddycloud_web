// SPDX-License-Identifier: GPL-2.0-only
// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { isPresentedTag, LiveUpdatesProvider, useLiveUpdates } from "./LiveUpdates";
import type { LiveEvent } from "./liveStream";

const state = vi.hoisted(() => ({
    receive: undefined as ((event: LiveEvent) => void) | undefined,
    invalidate: vi.fn(),
    notify: vi.fn(),
    stop: vi.fn(),
}));
vi.mock("./liveStream", () => ({
    subscribeToEvents: (receive: (event: LiveEvent) => void) => {
        state.receive = receive;
        return state.stop;
    },
}));
vi.mock("../provider/TeddyCloudProvider", () => ({
    useTeddyCloud: () => ({ invalidateTonies: state.invalidate, addNotification: state.notify }),
}));
vi.mock("./text", () => ({ useGoText: () => (key: string) => key }));

afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
});
it("highlights immediately, respects box overlays, coalesces refreshes and closes on logout", async () => {
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    const root = createRoot(container);
    const ruid = "11000000500304e0";
    function Probe() {
        const { presented, revision } = useLiveUpdates();
        return (
            <div
                data-revision={revision}
                data-all={String(isPresentedTag(presented, ruid, ""))}
                data-owner={String(isPresentedTag(presented, ruid, "box-one"))}
                data-other={String(isPresentedTag(presented, ruid, "box-two"))}
            />
        );
    }
    await act(async () =>
        root.render(
            <LiveUpdatesProvider>
                <Probe />
            </LiveUpdatesProvider>,
        ),
    );
    const event = {
        type: "tag-present",
        data: { box: "box-one", ruid: ruid.toUpperCase(), time: 1 },
    };
    await act(async () => state.receive!(event));
    expect(container.firstElementChild?.getAttribute("data-all")).toBe("true");
    expect(container.firstElementChild?.getAttribute("data-owner")).toBe("true");
    expect(container.firstElementChild?.getAttribute("data-other")).toBe("false");
    expect(state.invalidate).not.toHaveBeenCalled();
    expect(state.notify).toHaveBeenCalledTimes(1);
    await act(async () => {
        state.receive!(event);
        state.receive!({ type: "tag-updated", data: event.data });
        await vi.advanceTimersByTimeAsync(100);
    });
    expect(state.notify).toHaveBeenCalledTimes(1);
    expect(state.invalidate).toHaveBeenCalledTimes(1);
    await act(async () =>
        state.receive!({
            type: "tag-present",
            data: { box: "box-one", ruid: "22000000500304e0", time: 2 },
        }),
    );
    expect(container.firstElementChild?.getAttribute("data-all")).toBe("false");
    await act(async () =>
        state.receive!({
            type: "tag-state",
            data: [{ box: "box-one", ruid, time: 3 }],
        }),
    );
    expect(container.firstElementChild?.getAttribute("data-owner")).toBe("true");
    expect(state.notify).toHaveBeenCalledTimes(2);
    await act(async () =>
        state.receive!({
            type: "tag-present",
            data: { box: "box-one", ruid: "22000000500304e0", time: 1 },
        }),
    );
    expect(container.firstElementChild?.getAttribute("data-owner")).toBe("true");
    expect(state.notify).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.stop).toHaveBeenCalledTimes(1);
    expect(state.invalidate).toHaveBeenCalledTimes(1);
});
