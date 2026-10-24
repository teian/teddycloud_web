// SPDX-License-Identifier: GPL-2.0-only
// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
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
}));
vi.mock("./liveStream", () => ({
    subscribeToEvents: (receive: (event: LiveEvent) => void) => {
        stream.receive = receive;
        return stream.stop;
    },
}));
const event: LiveEvent = {
    type: "rtnl-raw-log3",
    box: "box",
    data: { datetime: 1792863103, field2: 13 },
};

it("bounds retained history by count and bytes and ignores unrelated events", () => {
    let state: RtnlBuffer = { entries: [], bytes: 0, dropped: 0 };
    expect(appendRtnl(state, { type: "heartbeat", data: null }, "now")).toBe(state);
    for (let i = 0; i < MAX_RTNL_ENTRIES + 7; i++) state = appendRtnl(state, event, String(i));
    expect(state.entries).toHaveLength(MAX_RTNL_ENTRIES);
    expect(state.dropped).toBe(7);
    state = appendRtnl(state, { type: "rtnl-raw-log2", data: "a".repeat(2 * 1024 * 1024) }, "huge");
    expect(state.entries).toHaveLength(0);
    expect(state.bytes).toBe(0);
});

it("records across page changes, pauses, resumes and clears when the user changes", async () => {
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
    await act(async () => stream.receive!(event));
    await act(async () =>
        root.render(
            <RtnlRecorderProvider>
                <Page name="rtnl" />
            </RtnlRecorderProvider>,
        ),
    );
    expect(container.firstElementChild?.getAttribute("data-count")).toBe("1");
    await act(async () => controls!.togglePause());
    await act(async () => stream.receive!(event));
    expect(container.firstElementChild?.getAttribute("data-count")).toBe("1");
    await act(async () => controls!.togglePause());
    await act(async () => stream.receive!(event));
    expect(container.firstElementChild?.getAttribute("data-count")).toBe("2");
    await act(async () => window.dispatchEvent(new Event(USER_STORAGE_SCOPE_EVENT)));
    expect(container.firstElementChild?.getAttribute("data-count")).toBe("0");
    await act(async () => root.unmount());
    expect(stream.stop).toHaveBeenCalledOnce();
});
