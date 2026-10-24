// SPDX-License-Identifier: GPL-2.0-only
import type { LiveEvent } from "../../../goteddycloud/liveStream";

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

const names3: Record<number, [string, string]> = {
    1: ["Large ear pressed", "Großes Ohr gedrückt"],
    2: ["Small ear pressed", "Kleines Ohr gedrückt"],
    3: ["Knock forward", "Klopfen vorwärts"],
    4: ["Knock backward", "Klopfen rückwärts"],
    5: ["Tilt forward", "Nach vorne geneigt"],
    6: ["Tilt backward", "Nach hinten geneigt"],
    7: ["Charger connected", "Ladestation verbunden"],
    8: ["Charger disconnected", "Ladestation getrennt"],
    11: ["Playback starting", "Wiedergabe startet"],
    12: ["Playback started", "Wiedergabe gestartet"],
    13: ["Playback stopped", "Wiedergabe gestoppt"],
};

const object = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
const number = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
const string = (value: unknown) => (typeof value === "string" ? value : "");

function bytes(hex: string): Uint8Array {
    if (hex.length % 2 || !/^[0-9a-f]*$/i.test(hex) || hex.length > 131070) return new Uint8Array();
    return Uint8Array.from(hex.match(/../g) || [], (pair) => parseInt(pair, 16));
}

function cstring(data: Uint8Array, offset = 0): string {
    const end = data.indexOf(0, offset);
    return new TextDecoder().decode(data.slice(offset, end < 0 ? data.length : end));
}

export function decodeRtnl(record: RecordedRtnlEvent, german = false): DecodedRtnlEntry {
    const { event, receivedAt } = record;
    const data = object(event.data);
    const text = (en: string, de: string) => (german ? de : en);
    const box = string(event.box) || string(data.box);
    const entry: DecodedRtnlEntry = {
        receivedAt,
        box,
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
        entry.known = Boolean(names3[code]);
        entry.summary =
            names3[code]?.[german ? 1 : 0] ||
            text("Unknown Log3 event", "Unbekanntes Log3-Ereignis") + ` ${code}`;
        entry.fields = { code, boxTime: new Date(timestamp * 1000).toISOString() };
        entry.rawText = `Raw3 | Datetime: ${timestamp} Unknown: ${code}`;
        return entry;
    }
    if (event.type !== "rtnl-raw-log2") {
        entry.known = true;
        entry.summary =
            event.type === "tag-present"
                ? text("Tag presented", "Tag aufgelegt")
                : text("Tag information updated", "Tag-Informationen aktualisiert");
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
    entry.summary = text("Unknown function", "Unbekannte Funktion") + ` ${key}`;
    const ascii = Array.from(payload, (byte) =>
        byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ".",
    ).join("");
    entry.rawText = `Raw2 | #${data.sequence} Uptime: ${data.uptime} Func: ${key} Payload: '${hex}' ASCII: '${ascii}'`;
    if (data.field8 !== undefined) entry.rawText += ` Field8: ${data.field8}`;
    if (data.field9) entry.rawText += ` Field9: '${string(data.field9)}'`;
    const named = (en: string, de: string, needed = 0) => {
        entry.known = true;
        entry.summary = text(en, de);
        if (payload.length < needed) {
            fields.truncated = true;
            entry.summary += text(" (truncated payload)", " (unvollständige Nutzdaten)");
            return false;
        }
        return true;
    };
    const tag = () => {
        const uid = (BigInt(view.getUint32(4)) << 32n) | BigInt(view.getUint32(0));
        fields.uid = uid.toString(16).padStart(16, "0").toUpperCase();
        fields.ruid = String(fields.uid).match(/../g)!.reverse().join("").toLowerCase();
    };
    if (["15-8627", "15-16065", "15-8646", "15-15452", "15-8630", "15-16067"].includes(key)) {
        const removed = fn === 8630 || fn === 16067;
        const invalid = fn === 8646 || fn === 15452;
        if (
            named(
                removed ? "Tag removed" : invalid ? "Invalid tag detected" : "Valid tag detected",
                removed
                    ? "Tag entfernt"
                    : invalid
                      ? "Ungültiger Tag erkannt"
                      : "Gültiger Tag erkannt",
                8,
            )
        )
            tag();
    } else if (["20-6803", "20-16096", "22-297", "22-16096"].includes(key)) {
        if (named("Audio ID reported", "Audio-ID gemeldet", 4)) {
            fields.audioId = view.getUint32(0, true);
            fields.audioIdHex = "0x" + Number(fields.audioId).toString(16).padStart(8, "0");
        }
    } else if (key === "22-6480") {
        named("Playing local file", "Lokale Datei wird abgespielt");
        fields.path = cstring(payload);
        const match = /^\/?content\/([a-f0-9]{8})\/([a-f0-9]{8})$/i.exec(String(fields.path));
        if (match) fields.ruid = (match[1] + match[2]).toLowerCase();
    } else if (key === "6-110") {
        named("HTTP request", "HTTP-Anfrage");
        fields.path = cstring(payload);
        const next = payload.indexOf(0);
        if (next >= 0 && next + 1 < payload.length) fields.host = cstring(payload, next + 1);
    } else if (key === "6-8628") {
        // Observed CC3200 format; keep the uncertainty explicit in exports/UI.
        if (named("HTTP result (inferred format)", "HTTP-Ergebnis (Format abgeleitet)", 16)) {
            tag();
            fields.resultRaw = view.getUint32(8, true);
            fields.statusCandidate = view.getUint32(12, true);
            fields.interpretation = "inferred";
        }
    } else if (key === "6-1009" || key === "37-1009") {
        named("Network domain", "Netzwerk-Domain");
        fields.domain = cstring(payload);
    } else if (["8-703", "8-704", "8-7146"].includes(key)) {
        named("Firmware information", "Firmware-Information");
        fields.text = cstring(payload, fn === 7146 ? 8 : 0);
    } else if (["27-8672", "27-15524"].includes(key)) {
        if (named("Volume changed", "Lautstärke geändert", 12)) {
            fields.volumeDb = view.getInt32(4, true);
            fields.volume = view.getInt32(8, true);
        }
    } else if (["12-15426", "12-15427"].includes(key)) {
        if (named("Orientation reported", "Ausrichtung gemeldet", 4))
            fields.value = view.getInt32(0, true);
    }
    if (!entry.known || fields.truncated) {
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
) {
    return {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        droppedEntries: dropped,
        boxFilter: box,
        entries: entries
            .map((entry) => decodeRtnl(entry, german))
            .filter((entry) => !box || entry.box === box),
    };
}
