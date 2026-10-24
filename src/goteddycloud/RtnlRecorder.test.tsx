// SPDX-License-Identifier: GPL-2.0-only
// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
    appendRtnl,
    MAX_RTNL_ENTRIES,
    RtnlRecorderProvider,
    useRtnlRecorder,
    type RtnlBuffer,
} from "./RtnlRecorder";
import type { LiveEvent } from "./liveStream";
import { USER_STORAGE_SCOPE_EVENT } from "../utils/storage/userStorage";

const stream = vi.hoisted(() => ({
    receive: undefined as ((event: LiveEvent) => void) | undefined,
    stop: vi.fn(),
    reload: vi.fn(),
    connected: undefined as (() => void) | undefined,
}));
vi.mock("./liveStream", () => ({
    subscribeToEvents: (receive: (event: LiveEvent) => void, connected: () => void) => {
        stream.receive = receive;
        stream.connected = connected;
        connected();
        return stream.stop;
    },
}));
vi.mock("../components/settings/rtnl/hooks/useRtnlMapping", () => ({
    useRtnlMapping: () => ({
        mapping: null,
        mappingLoading: false,
        mappingError: false,
        reloadMapping: stream.reload,
    }),
}));
const event: LiveEvent = {
    type: "rtnl-raw-log3",
    box: "box",
    data: { datetime: 1792863103, field2: 13 },
};
afterEach(() => vi.useRealTimers());

it("bounds retained history by count and bytes and ignores unrelated events", () => {
    let state: RtnlBuffer = { entries: [], bytes: 0, dropped: 0 };
    expect(appendRtnl(state, { type: "heartbeat", data: null }, "now")).toBe(state);
    expect(
        appendRtnl(state, { type: "audio-sync", box: "box", data: { phase: "claim" } }, "now")
            .entries,
    ).toHaveLength(1);
    for (let i = 0; i < MAX_RTNL_ENTRIES + 7; i++) state = appendRtnl(state, event, String(i));
    expect(state.entries).toHaveLength(MAX_RTNL_ENTRIES);
    expect(state.dropped).toBe(7);
    state = appendRtnl(state, { type: "rtnl-raw-log2", data: "a".repeat(2 * 1024 * 1024) }, "huge");
    expect(state.entries).toHaveLength(0);
    expect(state.bytes).toBe(0);
});

it("records across page changes, pauses, resumes and clears when the user changes", async () => {
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    const root = createRoot(container);
    let controls: ReturnType<typeof useRtnlRecorder>;
    function Page({ name }: { name: string }) {
        controls = useRtnlRecorder();
        return <div data-page={name} data-count={controls.entries.length} />;
    }
    await act(async () =>
        root.render(
            <RtnlRecorderProvider>
                <Page name="tonies" />
            </RtnlRecorderProvider>,
        ),
    );
    await act(async () => {
        stream.receive!(event);
        vi.advanceTimersByTime(100);
    });
    await act(async () =>
        root.render(
            <RtnlRecorderProvider>
                <Page name="rtnl" />
            </RtnlRecorderProvider>,
        ),
    );
    expect(container.firstElementChild?.getAttribute("data-count")).toBe("1");
    await act(async () => controls!.togglePause());
    await act(async () => {
        stream.receive!(event);
        vi.advanceTimersByTime(100);
    });
    expect(container.firstElementChild?.getAttribute("data-count")).toBe("1");
    await act(async () => controls!.togglePause());
    await act(async () => {
        stream.receive!(event);
        vi.advanceTimersByTime(100);
    });
    expect(container.firstElementChild?.getAttribute("data-count")).toBe("2");
    // A queued event must not reappear after a user/session reset.
    await act(async () => stream.receive!(event));
    await act(async () => window.dispatchEvent(new Event(USER_STORAGE_SCOPE_EVENT)));
    await act(async () => vi.advanceTimersByTime(100));
    expect(container.firstElementChild?.getAttribute("data-count")).toBe("0");
    await act(async () => root.unmount());
    expect(stream.stop).toHaveBeenCalledOnce();
});

it("publishes a burst to consumers as one bounded batch", async () => {
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    const root = createRoot(container);
    let renders = 0;
    function Page() {
        renders++;
        const recorder = useRtnlRecorder();
        return <div data-count={recorder.entries.length} data-dropped={recorder.dropped} />;
    }
    await act(async () =>
        root.render(
            <RtnlRecorderProvider>
                <Page />
            </RtnlRecorderProvider>,
        ),
    );
    await act(async () => {
        for (let i = 0; i < 2010; i++) stream.receive!(event);
    });
    expect(renders).toBe(1);
    await act(async () => vi.advanceTimersByTime(100));
    expect(renders).toBe(2);
    expect(container.firstElementChild?.getAttribute("data-count")).toBe("2000");
    expect(container.firstElementChild?.getAttribute("data-dropped")).toBe("10");
    stream.reload.mockClear();
    await act(async () => stream.connected!());
    expect(stream.reload).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
});
