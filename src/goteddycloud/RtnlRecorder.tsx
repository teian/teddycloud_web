// SPDX-License-Identifier: GPL-2.0-only
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { subscribeToEvents, type LiveEvent } from "./liveStream";
import { USER_STORAGE_SCOPE_EVENT } from "../utils/storage/userStorage";
import type { RecordedRtnlEvent } from "../components/settings/rtnl/rtnlDecoder";
import { useRtnlMapping } from "../components/settings/rtnl/hooks/useRtnlMapping";

export const MAX_RTNL_ENTRIES = 2000;
const MAX_BYTES = 2 * 1024 * 1024;
type StoredEntry = RecordedRtnlEvent & { bytes: number };
export type RtnlBuffer = { entries: StoredEntry[]; bytes: number; dropped: number };
const empty = (): RtnlBuffer => ({ entries: [], bytes: 0, dropped: 0 });

function boundedBuffer(entries: StoredEntry[], bytes: number, dropped: number): RtnlBuffer {
    let start = 0;
    while (entries.length - start > MAX_RTNL_ENTRIES || bytes > MAX_BYTES) {
        bytes -= entries[start++].bytes;
        dropped++;
    }
    return { entries: start ? entries.slice(start) : entries, bytes, dropped };
}

export function appendRtnl(buffer: RtnlBuffer, event: LiveEvent, receivedAt: string): RtnlBuffer {
    if (
        !["rtnl-raw-log2", "rtnl-raw-log3", "tag-present", "tag-updated", "audio-sync"].includes(
            event.type,
        )
    )
        return buffer;
    const size = JSON.stringify(event).length * 2;
    const entries = [...buffer.entries, { event, receivedAt, bytes: size }];
    return boundedBuffer(entries, buffer.bytes + size, buffer.dropped);
}

type Recorder = RtnlBuffer &
    ReturnType<typeof useRtnlMapping> & {
        paused: boolean;
        togglePause: () => void;
        clearRtnl: () => void;
    };
const RtnlContext = createContext<Recorder>({
    ...empty(),
    paused: false,
    togglePause: () => {},
    clearRtnl: () => {},
    mapping: null,
    mappingLoading: true,
    mappingError: false,
    reloadMapping: () => {},
});

export function RtnlRecorderProvider({ children }: { children: ReactNode }) {
    const mappingState = useRtnlMapping();
    const { reloadMapping } = mappingState;
    const [buffer, setBuffer] = useState(empty);
    const [paused, setPaused] = useState(false);
    const pauseRef = useRef(false);
    const pending = useRef(empty());
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const flush = useCallback(() => {
        clearTimeout(timer.current);
        timer.current = undefined;
        const batch = pending.current;
        pending.current = empty();
        if (batch.entries.length || batch.dropped)
            setBuffer((current) =>
                boundedBuffer(
                    [...current.entries, ...batch.entries],
                    current.bytes + batch.bytes,
                    current.dropped + batch.dropped,
                ),
            );
    }, []);
    const clearRtnl = useCallback(() => {
        clearTimeout(timer.current);
        timer.current = undefined;
        pending.current = empty();
        setBuffer(empty());
    }, []);
    const togglePause = useCallback(() => {
        flush();
        pauseRef.current = !pauseRef.current;
        setPaused(pauseRef.current);
    }, [flush]);
    useEffect(() => {
        let connectedBefore = false;
        const stop = subscribeToEvents(
            (event) => {
                if (!pauseRef.current) {
                    const receivedAt = new Date().toISOString();
                    pending.current = appendRtnl(pending.current, event, receivedAt);
                    if (
                        (pending.current.entries.length || pending.current.dropped) &&
                        timer.current === undefined
                    )
                        timer.current = setTimeout(flush, 100);
                }
            },
            () => {
                // A backend upgrade closes the stream. Refresh its registry on
                // reconnect without issuing one request for each RTNL event.
                if (connectedBefore) reloadMapping();
                connectedBefore = true;
            },
        );
        const reset = () => {
            clearRtnl();
            pauseRef.current = false;
            setPaused(false);
        };
        window.addEventListener(USER_STORAGE_SCOPE_EVENT, reset);
        window.addEventListener("teddycloud-auth-required", reset);
        return () => {
            stop();
            clearTimeout(timer.current);
            window.removeEventListener(USER_STORAGE_SCOPE_EVENT, reset);
            window.removeEventListener("teddycloud-auth-required", reset);
        };
    }, [clearRtnl, flush, reloadMapping]);
    return (
        <RtnlContext.Provider
            value={{ ...buffer, ...mappingState, paused, togglePause, clearRtnl }}
        >
            {children}
        </RtnlContext.Provider>
    );
}

export const useRtnlRecorder = () => useContext(RtnlContext);
