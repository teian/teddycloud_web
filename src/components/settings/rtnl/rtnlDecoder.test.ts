// SPDX-License-Identifier: GPL-2.0-only
import { expect, it } from "vitest";
import { decodeRtnl, rtnlSnapshot, type RecordedRtnlEvent } from "./rtnlDecoder";
import type { RtnlMapping } from "./rtnlMapping";

// Deliberately invented IDs/labels: a backend can introduce/reassign a mapping
// without shipping another frontend. Real firmware IDs are tested over the API.
const mapping: RtnlMapping = {
    schemaVersion: 1,
    revision: "server-test-revision",
    events: {
        "audio-sync": {
            label: { en: "Server event" },
            selector: "phase",
            variants: { "new-phase": { en: "New server phase", de: "Neue Serverphase" } },
        },
    },
    log3: { "42": { en: "Server playback event", de: "Server-Wiedergabeereignis" } },
    log2: {
        "77-1": {
            label: { en: "Server tag", de: "Server-Tag" },
            minBytes: 12,
            fields: [
                { name: "uid", type: "uid", offset: 4 },
                { name: "ruid", type: "ruid", offset: 4 },
            ],
        },
        "77-2": {
            label: { en: "Server audio" },
            minBytes: 4,
            fields: [
                { name: "audioId", type: "u32le" },
                { name: "audioIdHex", type: "hex32le" },
            ],
        },
        "77-3": {
            label: { en: "Server file" },
            minBytes: 0,
            fields: [
                { name: "path", type: "cstring" },
                { name: "ruid", type: "content-ruid" },
            ],
        },
        "77-4": {
            label: { en: "Server request" },
            minBytes: 0,
            fields: [
                { name: "path", type: "cstring" },
                { name: "host", type: "next-cstring" },
            ],
        },
        "77-5": {
            label: { en: "Inferred server result" },
            minBytes: 8,
            interpretation: "inferred",
            fields: [
                { name: "resultRaw", type: "u32le" },
                { name: "statusCandidate", type: "u32le", offset: 4 },
            ],
        },
        "77-6": {
            label: { en: "Counters" },
            minBytes: 0,
            interpretation: "partial",
            rawValues: true,
            fields: [],
        },
        "77-7": {
            label: { en: "Signed value" },
            minBytes: 4,
            fields: [{ name: "volume", type: "i32le" }],
        },
    },
};
const packet = (fn: number, payload: string): RecordedRtnlEvent => ({
    receivedAt: "2026-10-24T16:00:00.000Z",
    event: {
        type: "rtnl-raw-log2",
        box: "6CC374F2CBD8",
        data: {
            function_group: 77,
            function: fn,
            field6: payload,
            sequence: 937,
            uptime: 599775,
        },
    },
});
const decode = (fn: number, payload: string) => decodeRtnl(packet(fn, payload), true, mapping);

it("uses backend function IDs, labels, byte offsets and field names", () => {
    const tag = decode(1, "DEADBEEF0EEA3CBEE0040350");
    expect(tag.summary).toBe("Server-Tag");
    expect(tag.fields).toMatchObject({ uid: "E00403500EEA3CBE", ruid: "be3cea0e500304e0" });
    expect(decode(2, "DB4F696118000000").fields).toMatchObject({
        audioId: 1634291675,
        audioIdHex: "0x61694fdb",
    });
    expect(decode(7, "FFFFFFFF").fields.volume).toBe(-1);
    mapping.log2["77-99"] = {
        label: { en: "Introduced by server" },
        minBytes: 4,
        fields: [{ name: "newField", type: "u32le" }],
    };
    expect(decode(99, "FFFFFFFF").fields.newField).toBe(4294967295);
    delete mapping.log2["77-99"];
});

it("reads strings and derives content identity using backend field formats", () => {
    const path = "636F6E74656E742F62653363656130652F3530303330346530007E163403D0E9DC6A";
    expect(decode(3, path).fields).toMatchObject({
        path: "content/be3cea0e/500304e0",
        ruid: "be3cea0e500304e0",
    });
    const request =
        "2F76312F636C61696D2F626533636561306535303033303465300074632E676568616E6E2E697400";
    expect(decode(4, request).fields).toMatchObject({
        path: "/v1/claim/be3cea0e500304e0",
        host: "tc.gehann.it",
    });
    expect(decode(5, "00000000C8000000").fields).toMatchObject({
        resultRaw: 0,
        statusCandidate: 200,
        interpretation: "inferred",
    });
});

it("uses backend Log3/event phase labels and falls back to English", () => {
    const record: RecordedRtnlEvent = {
        receivedAt: "now",
        event: { type: "rtnl-raw-log3", data: { datetime: 1792863103, field2: 42 } },
    };
    expect(decodeRtnl(record, true, mapping).summary).toBe("Server-Wiedergabeereignis");
    const phase = decodeRtnl(
        { receivedAt: "now", event: { type: "audio-sync", data: { phase: "new-phase" } } },
        true,
        mapping,
    );
    expect(phase.summary).toBe("Neue Serverphase");
    expect(decode(2, "00000000").summary).toBe("Server audio");
});

it("keeps missing mappings, truncated payloads and unsupported future field formats readable", () => {
    const record = packet(2, "FFFFFFFF1B000000");
    const unavailable = decodeRtnl(record, true);
    expect(unavailable.known).toBe(false);
    expect(unavailable.fields.u32le).toEqual([4294967295, 27]);
    expect(unavailable.raw).toBe(record.event);
    expect(decode(2, "DB").fields.truncated).toBe(true);
    expect(decode(2, "not hex").fields.truncated).toBe(true);
    const future = {
        ...mapping,
        log2: {
            "77-2": {
                label: { en: "Future" },
                minBytes: 0,
                fields: [{ name: "value", type: "future-format" }],
            },
        },
    };
    const unknown = decodeRtnl(record, false, future);
    expect(unknown.known).toBe(false);
    expect(unknown.fields).toMatchObject({ unsupportedFormat: true, u32le: [4294967295, 27] });
    expect(decode(6, "46010000070000000900000002000000").fields).toMatchObject({
        interpretation: "partial",
        u32le: [326, 7, 9, 2],
    });
});

it("exports the mapping revision alongside complete raw and decoded events", () => {
    const first = packet(2, "DB4F696118000000");
    const second = packet(1, "DEADBEEF0EEA3CBEE0040350");
    second.event.box = "OTHER";
    const saved = rtnlSnapshot([first, second], true, 15, "6CC374F2CBD8", mapping);
    expect(saved).toMatchObject({
        schemaVersion: 1,
        mappingSchemaVersion: 1,
        mappingRevision: "server-test-revision",
        droppedEntries: 15,
    });
    expect(saved.entries).toHaveLength(1);
    expect(saved.entries[0]).toMatchObject({ fields: { audioId: 1634291675 }, raw: first.event });
    expect(rtnlSnapshot([first], false, 0).mappingRevision).toBeNull();
});
