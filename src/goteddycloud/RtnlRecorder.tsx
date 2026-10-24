// SPDX-License-Identifier: GPL-2.0-only
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { subscribeToEvents, type LiveEvent } from "./liveStream";
import { USER_STORAGE_SCOPE_EVENT } from "../utils/storage/userStorage";
import type { RecordedRtnlEvent } from "../components/settings/rtnl/rtnlDecoder";

export const MAX_RTNL_ENTRIES = 2000;
const MAX_BYTES = 2 * 1024 * 1024;
type StoredEntry = RecordedRtnlEvent & { bytes: number };
export type RtnlBuffer = { entries: StoredEntry[]; bytes: number; dropped: number };
const empty = (): RtnlBuffer => ({ entries: [], bytes: 0, dropped: 0 });

export function appendRtnl(buffer: RtnlBuffer, event: LiveEvent, receivedAt: string): RtnlBuffer {
    if (!["rtnl-raw-log2", "rtnl-raw-log3", "tag-present", "tag-updated"].includes(event.type))
        return buffer;
    const size = JSON.stringify(event).length * 2;
    const entries = [...buffer.entries, { event, receivedAt, bytes: size }];
    let bytes = buffer.bytes + size;
    let dropped = buffer.dropped;
    while (entries.length > MAX_RTNL_ENTRIES || bytes > MAX_BYTES) {
        bytes -= entries.shift()!.bytes;
        dropped++;
    }
    return { entries, bytes, dropped };
}

type Recorder = RtnlBuffer & { paused: boolean; togglePause: () => void; clearRtnl: () => void };
const RtnlContext = createContext<Recorder>({
    ...empty(),
    paused: false,
    togglePause: () => {},
    clearRtnl: () => {},
});

export function RtnlRecorderProvider({ children }: { children: ReactNode }) {
    const [buffer, setBuffer] = useState(empty);
    const [paused, setPaused] = useState(false);
    const pauseRef = useRef(false);
    const clearRtnl = useCallback(() => setBuffer(empty()), []);
    const togglePause = useCallback(() => {
        pauseRef.current = !pauseRef.current;
        setPaused(pauseRef.current);
    }, []);
    useEffect(() => {
        const stop = subscribeToEvents((event) => {
            if (!pauseRef.current) {
                const receivedAt = new Date().toISOString();
                setBuffer((current) => appendRtnl(current, event, receivedAt));
            }
        });
        const reset = () => {
            setBuffer(empty());
            pauseRef.current = false;
            setPaused(false);
        };
        window.addEventListener(USER_STORAGE_SCOPE_EVENT, reset);
        window.addEventListener("teddycloud-auth-required", reset);
        return () => {
            stop();
            window.removeEventListener(USER_STORAGE_SCOPE_EVENT, reset);
            window.removeEventListener("teddycloud-auth-required", reset);
        };
    }, []);
    return (
        <RtnlContext.Provider value={{ ...buffer, paused, togglePause, clearRtnl }}>
            {children}
        </RtnlContext.Provider>
    );
}

export const useRtnlRecorder = () => useContext(RtnlContext);
