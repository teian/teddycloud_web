// SPDX-License-Identifier: GPL-2.0-only
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeEvents, subscribeToEvents } from "./liveStream";
import { resetBasePathCache } from "../utils/basePath";

function response(text: string, fragment = 5) {
    const bytes = new TextEncoder().encode(text);
    return new Response(
        new ReadableStream({
            start(controller) {
                for (let i = 0; i < bytes.length; i += fragment) {
                    controller.enqueue(bytes.slice(i, i + fragment));
                }
                controller.close();
            },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
    );
}

describe("authenticated live stream", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        vi.unstubAllEnvs();
        sessionStorage.clear();
    });
    it("decodes fragmented UTF-8, CRLF, multiline data and successive named events", async () => {
        const events: unknown[] = [];
        await consumeEvents(
            response(
                ': heartbeat\r\nevent: tag-present\r\ndata: {"type":"tag-present",\r\n' +
                    'data: "data":{"box":"box","ruid":"11000000500304e0","title":"Bär"}}\r\n\r\n' +
                    'event: tag-updated\ndata: {"type":"tag-updated","data":{"box":"box"}}\n\n',
                1,
            ),
            (event) => events.push(event),
        );
        expect(events).toEqual([
            { type: "tag-present", data: { box: "box", ruid: "11000000500304e0", title: "Bär" } },
            { type: "tag-updated", data: { box: "box" } },
        ]);
    });
    it("ignores malformed frames and bounds incomplete frames", async () => {
        const events: unknown[] = [];
        await consumeEvents(
            response('data: invalid\n\ndata: null\n\ndata: {"type":"keep-alive","data":""}\n\n'),
            (event) => events.push(event),
        );
        expect(events).toEqual([{ type: "keep-alive", data: "" }]);
        await expect(
            consumeEvents(response("data: " + "x".repeat(65537), 1000), () => {}),
        ).rejects.toThrow("frame too large");
    });
    it("accepts many small frames coalesced into a large transport chunk", async () => {
        const receive = vi.fn();
        await consumeEvents(
            response('data: {"type":"keep-alive","data":""}\n\n'.repeat(3000), 200000),
            receive,
        );
        expect(receive).toHaveBeenCalledTimes(3000);
    });
    it("uses the proxy prefix and bearer header, reconnects, and aborts on cleanup", async () => {
        vi.useFakeTimers();
        vi.stubEnv("VITE_APP_TEDDYCLOUD_API_URL", "");
        document.head.innerHTML = '<base href="https://example.test/cloud/web/">';
        resetBasePathCache();
        sessionStorage.setItem("teddycloud_web_token", "synthetic-token");
        const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
        const signals: AbortSignal[] = [];
        const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
            signals.push(init!.signal as AbortSignal);
            return new Response(
                new ReadableStream({
                    start(controller) {
                        streams.push(controller);
                        init!.signal!.addEventListener("abort", () =>
                            controller.error(new Error("aborted")),
                        );
                    },
                }),
                { headers: { "Content-Type": "text/event-stream" } },
            );
        });
        const opened = vi.fn();
        const stop = subscribeToEvents(() => {}, opened);
        try {
            await vi.advanceTimersByTimeAsync(0);
            expect(fetcher.mock.calls[0][0]).toBe("/cloud/api/sse");
            expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("Authorization")).toBe(
                "Bearer synthetic-token",
            );
            expect(opened).toHaveBeenCalledTimes(1);
            streams[0].close();
            await vi.advanceTimersByTimeAsync(1000);
            expect(opened).toHaveBeenCalledTimes(2);
        } finally {
            stop();
        }
        await vi.advanceTimersByTimeAsync(60000);
        expect(signals[1].aborted).toBe(true);
        expect(fetcher).toHaveBeenCalledTimes(2);
    });
    for (const status of [401, 403]) {
        it("stops reconnecting after access is denied: " + status, async () => {
            vi.useFakeTimers();
            const fetcher = vi
                .spyOn(globalThis, "fetch")
                .mockResolvedValue(new Response("", { status }));
            const stop = subscribeToEvents(
                () => {},
                () => {},
            );
            await vi.advanceTimersByTimeAsync(60000);
            stop();
            expect(fetcher).toHaveBeenCalledTimes(1);
        });
    }
    it("reconnects if heartbeats stop", async () => {
        vi.useFakeTimers();
        const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(
            async (_url, init) =>
                new Response(
                    new ReadableStream({
                        start(controller) {
                            init!.signal!.addEventListener("abort", () =>
                                controller.error(new Error("aborted")),
                            );
                        },
                    }),
                    { headers: { "Content-Type": "text/event-stream" } },
                ),
        );
        const stop = subscribeToEvents(
            () => {},
            () => {},
        );
        try {
            await vi.advanceTimersByTimeAsync(46000);
            expect(fetcher).toHaveBeenCalledTimes(2);
        } finally {
            stop();
        }
    });
});

it("shares one connection and keeps it alive until the final subscriber leaves", async () => {
    vi.useFakeTimers();
    const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(
        async (_url, init) =>
            new Response(
                new ReadableStream({
                    start(controller) {
                        streams.push(controller);
                        init!.signal!.addEventListener("abort", () =>
                            controller.error(new Error("aborted")),
                        );
                    },
                }),
                { headers: { "Content-Type": "text/event-stream" } },
            ),
    );
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = subscribeToEvents(first, () => {});
    const stopSecond = subscribeToEvents(second, () => {});
    try {
        await vi.advanceTimersByTimeAsync(0);
        streams[0].enqueue(
            new TextEncoder().encode(
                'data: {"type":"tag-present","data":{"ruid":"11000000500304e0"}}\n\n',
            ),
        );
        await vi.advanceTimersByTimeAsync(0);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(first).toHaveBeenCalledOnce();
        expect(second).toHaveBeenCalledOnce();
        stopFirst();
        streams[0].enqueue(new TextEncoder().encode('data: {"type":"keep-alive","data":""}\n\n'));
        await vi.advanceTimersByTimeAsync(0);
        expect(first).toHaveBeenCalledOnce();
        expect(second).toHaveBeenCalledTimes(2);
        expect(fetcher.mock.calls[0][1]!.signal!.aborted).toBe(false);
    } finally {
        stopFirst();
        stopSecond();
        vi.restoreAllMocks();
        vi.useRealTimers();
    }
    expect(fetcher.mock.calls[0][1]!.signal!.aborted).toBe(true);
});
