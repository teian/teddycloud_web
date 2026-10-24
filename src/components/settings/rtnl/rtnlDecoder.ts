// SPDX-License-Identifier: GPL-2.0-only
import type { LiveEvent } from "../../../goteddycloud/liveStream";
import type { RtnlField, RtnlLabel, RtnlMapping } from "./rtnlMapping";

export type RecordedRtnlEvent = { receivedAt: string; event: LiveEvent };
export type DecodedRtnlEntry = {
    receivedAt: string;
    box: string;
    kind: string;
    known: boolean;
    summary: string;
    fields: Record<string, unknown>;
    raw: LiveEvent;
    rawText: string;
};

const object = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
const number = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
const string = (value: unknown) => (typeof value === "string" ? value : "");
const label = (value: RtnlLabel, german: boolean) => (german ? value.de || value.en : value.en);

function bytes(hex: string): Uint8Array {
    if (hex.length % 2 || !/^[0-9a-f]*$/i.test(hex) || hex.length > 131070) return new Uint8Array();
    return Uint8Array.from(hex.match(/../g) || [], (pair) => parseInt(pair, 16));
}

function cstring(data: Uint8Array, offset = 0): string {
    const end = data.indexOf(0, offset);
    return new TextDecoder().decode(data.slice(offset, end < 0 ? data.length : end));
}

// Generic byte operations only: all function IDs, labels, field names, offsets
// and confidence annotations come from the backend's mapping registry.
function readField(
    field: RtnlField,
    payload: Uint8Array,
    view: DataView,
): { value?: unknown; truncated?: boolean; unsupported?: boolean } {
    const offset = field.offset ?? 0;
    const needed = ["uid", "ruid"].includes(field.type)
        ? 8
        : ["u32le", "i32le", "hex32le"].includes(field.type)
          ? 4
          : 0;
    if (offset + needed > payload.length) return { truncated: true };
    switch (field.type) {
        case "u32le":
            return { value: view.getUint32(offset, true) };
        case "i32le":
            return { value: view.getInt32(offset, true) };
        case "hex32le":
            return { value: "0x" + view.getUint32(offset, true).toString(16).padStart(8, "0") };
        case "uid":
        case "ruid": {
            const uid = (
                (BigInt(view.getUint32(offset + 4)) << 32n) |
                BigInt(view.getUint32(offset))
            )
                .toString(16)
                .padStart(16, "0");
            return {
                value:
                    field.type === "uid" ? uid.toUpperCase() : uid.match(/../g)!.reverse().join(""),
            };
        }
        case "cstring":
            return { value: cstring(payload, offset) };
        case "next-cstring": {
            const next = payload.indexOf(0, offset);
            return next >= 0 && next + 1 < payload.length
                ? { value: cstring(payload, next + 1) }
                : {};
        }
        case "content-ruid": {
            const match = /^\/?content\/([a-f0-9]{8})\/([a-f0-9]{8})$/i.exec(
                cstring(payload, offset),
            );
            return match ? { value: (match[1] + match[2]).toLowerCase() } : {};
        }
        default:
            return { unsupported: true };
    }
}

export function decodeRtnl(
    record: RecordedRtnlEvent,
    german = false,
    mapping: RtnlMapping | null = null,
): DecodedRtnlEntry {
    const { event, receivedAt } = record;
    const data = object(event.data);
    const text = (en: string, de: string) => (german ? de : en);
    const entry: DecodedRtnlEntry = {
        receivedAt,
        box: string(event.box) || string(data.box),
        kind: event.type,
        known: false,
        summary: "",
        fields: {},
        raw: event,
        rawText: JSON.stringify(event),
    };
    if (event.type === "rtnl-raw-log3") {
        const code = number(data.field2);
        const timestamp = number(data.datetime);
        const name = mapping?.log3[code];
        entry.known = Boolean(name);
        entry.summary = name
            ? label(name, german)
            : text("Unknown Log3 event", "Unbekanntes Log3-Ereignis") + ` ${code}`;
        const date = new Date(timestamp * 1000);
        entry.fields = { code, boxTime: Number.isNaN(date.getTime()) ? null : date.toISOString() };
        entry.rawText = `Raw3 | Datetime: ${timestamp} Unknown: ${code}`;
        return entry;
    }
    if (event.type !== "rtnl-raw-log2") {
        const definition = mapping?.events[event.type];
        entry.known = Boolean(definition);
        const name =
            definition?.variants?.[string(data[definition.selector ?? ""])] ?? definition?.label;
        entry.summary = name ? label(name, german) : text("Event", "Ereignis") + ` ${event.type}`;
        entry.fields = data;
        return entry;
    }
    const group = number(data.function_group);
    const fn = number(data.function);
    const hex = string(data.field6);
    const payload = bytes(hex);
    const view = new DataView(payload.buffer);
    const key = `${group}-${fn}`;
    const fields: Record<string, unknown> = {
        function: key,
        sequence: data.sequence,
        uptimeMs: data.uptime,
    };
    entry.fields = fields;
    const definition = mapping?.log2[key];
    entry.summary = definition
        ? label(definition.label, german)
        : text("Unknown function", "Unbekannte Funktion") + ` ${key}`;
    const ascii = Array.from(payload, (byte) =>
        byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ".",
    ).join("");
    entry.rawText = `Raw2 | #${data.sequence} Uptime: ${data.uptime} Func: ${key} Payload: '${hex}' ASCII: '${ascii}'`;
    if (data.field8 !== undefined) entry.rawText += ` Field8: ${data.field8}`;
    if (data.field9) entry.rawText += ` Field9: '${string(data.field9)}'`;
    if (definition) {
        entry.known = true;
        if (definition.interpretation) fields.interpretation = definition.interpretation;
        if (payload.length < definition.minBytes) fields.truncated = true;
        else {
            for (const field of definition.fields) {
                const result = readField(field, payload, view);
                if (result.truncated) fields.truncated = true;
                if (result.unsupported) {
                    fields.unsupportedFormat = true;
                    entry.known = false;
                }
                if (result.value !== undefined) fields[field.name] = result.value;
            }
        }
        if (fields.truncated)
            entry.summary += text(" (truncated payload)", " (unvollständige Nutzdaten)");
    }
    if (!entry.known || fields.truncated || definition?.rawValues) {
        fields.u32le = Array.from({ length: Math.floor(payload.length / 4) }, (_, i) =>
            view.getUint32(i * 4, true),
        );
        if (ascii) fields.ascii = ascii;
    }
    return entry;
}

export function formatDecoded(entry: DecodedRtnlEntry): string {
    const fields = Object.entries(entry.fields).map(
        ([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`,
    );
    return `${entry.receivedAt}${entry.box ? ` [${entry.box}]` : ""} ${entry.summary}${fields.length ? " | " + fields.join(" · ") : ""}`;
}

export function rtnlSnapshot(
    entries: RecordedRtnlEvent[],
    german: boolean,
    dropped: number,
    box = "",
    mapping: RtnlMapping | null = null,
) {
    return {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        droppedEntries: dropped,
        boxFilter: box,
        mappingSchemaVersion: mapping?.schemaVersion ?? null,
        mappingRevision: mapping?.revision ?? null,
        entries: entries
            .map((entry) => decodeRtnl(entry, german, mapping))
            .filter((entry) => !box || entry.box === box),
    };
}
