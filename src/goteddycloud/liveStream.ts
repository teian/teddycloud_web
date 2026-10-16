// SPDX-License-Identifier: GPL-2.0-only
import { defaultAPIConfig } from "../config/defaultApiConfig";

export type LiveEvent = { type: string; data: unknown };

// Fetch streaming retains the existing bearer/cookie authentication, including
// reverse-proxy prefixes. Native EventSource cannot attach the bearer header.
export async function consumeEvents(response: Response, receive: (event: LiveEvent) => void) {
    if (!response.body) throw new Error("Missing event stream");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let data: string[] = [];
    let size = 0;
    try {
        for (;;) {
            const chunk = await reader.read();
            if (chunk.done) return;
            buffer += decoder.decode(chunk.value, { stream: true });
            let end: number;
            while ((end = buffer.indexOf("\n")) >= 0) {
                const line = buffer.slice(0, end).replace(/\r$/, "");
                buffer = buffer.slice(end + 1);
                if (line.length + size > 65536) throw new Error("Event stream frame too large");
                if (!line) {
                    if (data.length) {
                        let event: LiveEvent | undefined;
                        try {
                            event = JSON.parse(data.join("\n"));
                        } catch {
                            // Ignore a malformed frame without losing following events.
                        }
                        if (event && typeof event.type === "string") receive(event);
                    }
                    data = [];
                    size = 0;
                } else if (line.startsWith("data:")) {
                    const value = line.slice(5).replace(/^ /, "");
                    data.push(value);
                    size += value.length;
                }
            }
            if (buffer.length + size > 65536) throw new Error("Event stream frame too large");
        }
    } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}

function openEventStream(receive: (event: LiveEvent) => void, connected: () => void): () => void {
    const lifetime = new AbortController();
    let attempt: AbortController | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setTimeout> | undefined;
    let delay = 1000;
    const config = defaultAPIConfig();
    const touch = () => {
        clearTimeout(heartbeat);
        heartbeat = setTimeout(() => attempt?.abort(), 45000);
    };
    const connect = async () => {
        if (lifetime.signal.aborted) return;
        attempt = new AbortController();
        touch();
        try {
            const response = await (config.fetchApi ?? fetch)(config.basePath + "/api/sse", {
                signal: attempt.signal,
                headers: { Accept: "text/event-stream" },
                cache: "no-store",
            });
            if (response.status === 401 || response.status === 403) return;
            if (
                !response.ok ||
                !response.headers.get("Content-Type")?.startsWith("text/event-stream")
            ) {
                throw new Error("Event stream unavailable");
            }
            delay = 1000;
            connected();
            await consumeEvents(response, (event) => {
                touch();
                receive(event);
            });
        } catch {
            // Transient disconnects recover without producing repeated UI errors.
        } finally {
            clearTimeout(heartbeat);
        }
        if (!lifetime.signal.aborted) {
            retry = setTimeout(connect, delay);
            delay = Math.min(delay * 2, 30000);
        }
    };
    void connect();
    return () => {
        lifetime.abort();
        attempt?.abort();
        clearTimeout(retry);
        clearTimeout(heartbeat);
    };
}

// Pages share the authenticated connection; opening RTNL must not consume a
// second server subscription or bypass bearer authentication.
const listeners = new Set<{ receive: (event: LiveEvent) => void; connected: () => void }>();
let disconnect: (() => void) | undefined;
let latestState: LiveEvent | undefined;
let isConnected = false;
export function subscribeToEvents(
    receive: (event: LiveEvent) => void,
    connected: () => void = () => {},
): () => void {
    const listener = { receive, connected };
    listeners.add(listener);
    if (!disconnect) {
        disconnect = openEventStream(
            (event) => {
                if (event.type === "tag-state") latestState = event;
                for (const entry of listeners) entry.receive(event);
            },
            () => {
                isConnected = true;
                for (const entry of listeners) entry.connected();
            },
        );
    } else {
        if (isConnected) connected();
        if (latestState) receive(latestState);
    }
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
            disconnect?.();
            disconnect = undefined;
            latestState = undefined;
            isConnected = false;
        }
    };
}
