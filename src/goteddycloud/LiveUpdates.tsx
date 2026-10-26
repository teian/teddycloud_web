// SPDX-License-Identifier: GPL-2.0-only
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTeddyCloud } from "../provider/TeddyCloudProvider";
import { NotificationTypeEnum } from "../types/teddyCloudNotificationTypes";
import { subscribeToEvents } from "./liveStream";
import { useGoText } from "./text";

export type PresentedTag = { box: string; ruid: string; time: number };
type LiveState = { presented: Record<string, PresentedTag>; revision: number };
const LiveContext = createContext<LiveState>({ presented: {}, revision: 0 });

export function LiveUpdatesProvider({ children }: { children: ReactNode }) {
    const { invalidateTonies, addNotification } = useTeddyCloud();
    const text = useGoText();
    const callbacks = useRef({ invalidateTonies, addNotification, text });
    callbacks.current = { invalidateTonies, addNotification, text };
    const [presented, setPresented] = useState<Record<string, PresentedTag>>({});
    const [revision, setRevision] = useState(0);

    useEffect(() => {
        let refresh: ReturnType<typeof setTimeout> | undefined;
        const last = new Map<string, PresentedTag>();
        const invalidate = () => {
            // Coalesce a presentation and its subsequent metadata updates.
            if (refresh !== undefined) return;
            refresh = setTimeout(() => {
                refresh = undefined;
                callbacks.current.invalidateTonies();
                setRevision((value) => value + 1);
            }, 100);
        };
        const close = subscribeToEvents((event) => {
            if (event.type === "tag-state" && Array.isArray(event.data)) {
                const current: Record<string, PresentedTag> = {};
                for (const tag of event.data) {
                    if (
                        tag &&
                        typeof tag.box === "string" &&
                        typeof tag.ruid === "string" &&
                        /^[a-f0-9]{16}$/i.test(tag.ruid) &&
                        typeof tag.time === "number"
                    ) {
                        current[tag.box] = { ...tag, ruid: tag.ruid.toLowerCase() };
                    }
                }
                last.clear();
                for (const tag of Object.values(current)) last.set(tag.box, tag);
                setPresented(current);
                invalidate();
                return;
            }
            if (event.type !== "tag-present" && event.type !== "tag-updated") return;
            const tag = event.data as PresentedTag | null;
            if (
                !tag ||
                typeof tag.box !== "string" ||
                typeof tag.ruid !== "string" ||
                !/^[a-f0-9]{16}$/i.test(tag.ruid)
            )
                return;
            if (event.type === "tag-present" && typeof tag.time === "number") {
                const value = { ...tag, ruid: tag.ruid.toLowerCase() };
                const previous = last.get(tag.box);
                if (previous && value.time < previous.time) return;
                // Highlight synchronously, before fetching the updated inventory.
                setPresented((current) =>
                    current[tag.box]?.time > value.time
                        ? current
                        : { ...current, [tag.box]: value },
                );
                last.set(tag.box, value);
                if (!previous || previous.ruid !== value.ruid || value.time - previous.time > 2) {
                    callbacks.current.addNotification(
                        NotificationTypeEnum.Info,
                        callbacks.current.text("tagPresented"),
                        value.ruid + (value.box ? " · " + value.box : ""),
                        callbacks.current.text("liveUpdates"),
                        false,
                    );
                }
            }
            invalidate();
        }, invalidate);
        return () => {
            close();
            clearTimeout(refresh);
        };
    }, []);

    const value = useMemo(() => ({ presented, revision }), [presented, revision]);
    return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLiveUpdates() {
    return useContext(LiveContext);
}

export function isPresentedTag(
    presented: LiveState["presented"],
    ruid: string,
    overlay: string | string[],
) {
    return Object.values(presented).some(
        (tag) =>
            tag.ruid === ruid.toLowerCase() &&
            (Array.isArray(overlay) ? overlay.includes(tag.box) : !overlay || tag.box === overlay),
    );
}
