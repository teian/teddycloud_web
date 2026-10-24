// SPDX-License-Identifier: GPL-2.0-only
import { expect, it } from "vitest";
import type { RecordedRtnlEvent } from "./rtnlDecoder";
import { rtnlBox, rtnlWindow, RTNL_PAGE_CHARACTERS, RTNL_PAGE_ENTRIES } from "./rtnlView";

const records = (count: number): RecordedRtnlEvent[] =>
    Array.from({ length: count }, (_, i) => ({
        receivedAt: String(i),
        event: { type: "tag-present", box: "box", data: { ruid: String(i) } },
    }));

it("decodes only the displayed bounded page of a full recording", () => {
    const history = records(2000);
    // Accessing an off-page event is a failure, including decoding just to filter.
    Object.defineProperty(history[0], "event", {
        get: () => {
            throw Error("off-page event decoded");
        },
    });
    const view = rtnlWindow(history, true, "both");
    expect(view.start).toBe(2000 - RTNL_PAGE_ENTRIES);
    expect(view.end).toBe(2000);
    expect(view.text.length).toBeLessThanOrEqual(RTNL_PAGE_CHARACTERS);
});

it("keeps history anchored while events arrive and permits paging in both directions", () => {
    const history = records(300);
    const latest = rtnlWindow(history, false, "raw");
    const anchor = history[latest.start - 1];
    const older = rtnlWindow(history, false, "raw", anchor);
    expect(older.end).toBe(latest.start);
    const appended = [...history, ...records(50)];
    expect(rtnlWindow(appended, false, "raw", anchor).text).toBe(older.text);
    const next = rtnlWindow(history, false, "raw", null, older.end);
    expect(next.start).toBe(latest.start);
    expect(next.end).toBe(latest.end);
    expect(rtnlWindow([], false, "raw").text).toBe("");
});

it("bounds large diagnostic text without truncating the recording or export", () => {
    const history = records(100);
    history.forEach((entry) => {
        entry.event.data = { detail: "X".repeat(100000) };
    });
    const view = rtnlWindow(history, false, "both");
    expect(view.truncated).toBe(true);
    expect(view.text.length).toBeLessThanOrEqual(RTNL_PAGE_CHARACTERS);
    expect(history[99].event.data).toEqual({ detail: "X".repeat(100000) });
    expect(
        rtnlBox({ receivedAt: "now", event: { type: "audio-sync", data: { box: "legacy" } } }),
    ).toBe("legacy");
});
