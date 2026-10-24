// SPDX-License-Identifier: GPL-2.0-only
import { decodeRtnl, formatDecoded, type RecordedRtnlEvent } from "./rtnlDecoder";
import type { RtnlMapping } from "./rtnlMapping";

export const RTNL_PAGE_ENTRIES = 100;
export const RTNL_PAGE_CHARACTERS = 64 * 1024;
const MAX_LINE = 16 * 1024;
export type RtnlMode = "decoded" | "raw" | "both";

export function rtnlBox(record: RecordedRtnlEvent): string {
    const { event } = record;
    if (event.box) return event.box;
    if (
        event.data &&
        typeof event.data === "object" &&
        "box" in event.data &&
        typeof event.data.box === "string"
    )
        return event.data.box;
    return "";
}

// Decode only the displayed page. Both the number of entries and text size are
// bounded, so a full recording or one large diagnostic cannot stall layout.
export function rtnlWindow(
    records: RecordedRtnlEvent[],
    german: boolean,
    mode: RtnlMode,
    anchor: RecordedRtnlEvent | null = null,
    forwardFrom?: number,
    mapping: RtnlMapping | null = null,
) {
    let end = anchor ? records.indexOf(anchor) + 1 : records.length;
    if (end <= 0) end = records.length;
    let start = end;
    let characters = 0;
    let truncated = false;
    const lines: string[] = [];
    const forward = forwardFrom !== undefined;
    if (forward) start = end = forwardFrom;
    for (let count = 0; count < RTNL_PAGE_ENTRIES; count++) {
        const index = forward ? end : start - 1;
        if (index < 0 || index >= records.length) break;
        const entry = decodeRtnl(records[index], german, mapping);
        let line =
            mode === "raw"
                ? `${entry.receivedAt}${entry.box ? ` [${entry.box}]` : ""} ${entry.rawText}`
                : formatDecoded(entry) + (mode === "both" ? "\n  " + entry.rawText : "");
        const shortened = line.length > MAX_LINE;
        if (shortened) line = line.slice(0, MAX_LINE) + " …";
        if (lines.length && characters + line.length + 1 > RTNL_PAGE_CHARACTERS) break;
        truncated ||= shortened;
        characters += line.length + 1;
        if (forward) {
            lines.push(line);
            end++;
        } else {
            lines.unshift(line);
            start--;
        }
    }
    return { start, end, text: lines.join("\n"), truncated };
}
