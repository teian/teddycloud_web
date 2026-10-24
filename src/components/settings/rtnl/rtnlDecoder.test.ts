// SPDX-License-Identifier: GPL-2.0-only
import { expect, it } from "vitest";
import { decodeRtnl, rtnlSnapshot, type RecordedRtnlEvent } from "./rtnlDecoder";

const packet = (group: number, fn: number, payload: string): RecordedRtnlEvent => ({
    receivedAt: "2026-10-24T16:00:00.000Z",
    event: {
        type: "rtnl-raw-log2",
        box: "6CC374F2CBD8",
        data: {
            function_group: group,
            function: fn,
            field6: payload,
            sequence: 937,
            uptime: 599775,
        },
    },
});

it("decodes the reported CC3200 tag, SD path, unsigned audio ID and playback events", () => {
    const tag = decodeRtnl(packet(15, 8627, "0EEA3CBEE0040350"), true);
    expect(tag.summary).toBe("Gültiger Tag erkannt");
    expect(tag.fields).toMatchObject({ uid: "E00403500EEA3CBE", ruid: "be3cea0e500304e0" });
    const removed = decodeRtnl(packet(15, 8630, "0EEA3CBEE0040350"), true);
    expect(removed.summary).toBe("Tag entfernt");
    const audio = decodeRtnl(packet(22, 297, "DB4F696118000000"), true);
    expect(audio.fields.audioId).toBe(1634291675);
    expect(audio.fields.audioIdHex).toBe("0x61694fdb");
    const path = "636F6E74656E742F62653363656130652F3530303330346530007E163403D0E9DC6A";
    expect(decodeRtnl(packet(22, 6480, path), true).fields).toMatchObject({
        path: "content/be3cea0e/500304e0",
        ruid: "be3cea0e500304e0",
    });
    const stopped = decodeRtnl(
        {
            receivedAt: tag.receivedAt,
            event: { type: "rtnl-raw-log3", data: { datetime: 1792863103, field2: 13 } },
        },
        true,
    );
    expect(stopped.summary).toBe("Wiedergabe gestoppt");
    expect(stopped.fields.boxTime).toMatch(/^2026-/);
});

it("separates request path/domain and marks inferred response formats explicitly", () => {
    const request = decodeRtnl(
        packet(
            6,
            110,
            "2F76312F636C61696D2F626533636561306535303033303465300074632E676568616E6E2E697400",
        ),
    );
    expect(request.fields).toMatchObject({
        path: "/v1/claim/be3cea0e500304e0",
        host: "tc.gehann.it",
    });
    const result = decodeRtnl(packet(6, 8628, "0EEA3CBEE004035000000000C8000000"));
    expect(result.fields).toMatchObject({ statusCandidate: 200, interpretation: "inferred" });
    expect(result.summary).toContain("inferred");
});

it("retains unknown functions and truncated packets without guessing their meaning", () => {
    const unknown = decodeRtnl(packet(24, 8427, "FFFFFFFF1B000000"), true);
    expect(unknown.known).toBe(false);
    expect(unknown.fields.u32le).toEqual([4294967295, 27]);
    expect(unknown.summary).toContain("Unbekannte Funktion 24-8427");
    expect(decodeRtnl(packet(22, 297, "DB"), true).fields.truncated).toBe(true);
    expect(decodeRtnl(packet(22, 297, "not hex"), true).fields.truncated).toBe(true);
});

it("exports received timestamps, decoded fields, complete raw events and the selected box", () => {
    const first = packet(22, 297, "DB4F696118000000");
    (first.event.data as Record<string, unknown>).field9 = "ABCD";
    const second = packet(15, 8627, "0EEA3CBEE0040350");
    second.event.box = "OTHER";
    const saved = JSON.parse(
        JSON.stringify(rtnlSnapshot([first, second], true, 15, "6CC374F2CBD8")),
    );
    expect(saved).toMatchObject({
        schemaVersion: 1,
        droppedEntries: 15,
        boxFilter: "6CC374F2CBD8",
    });
    expect(saved.entries).toHaveLength(1);
    expect(saved.entries[0]).toMatchObject({
        receivedAt: first.receivedAt,
        fields: { audioId: 1634291675 },
        raw: { data: { field9: "ABCD" } },
    });
});

it("retains server synchronization decisions alongside RTNL without inferring a transfer", () => {
    const record: RecordedRtnlEvent = {
        receivedAt: "2026-10-24T17:55:01.000Z",
        event: {
            type: "audio-sync",
            box: "6CC374F2CBD8",
            data: {
                phase: "freshness-response",
                status: 200,
                requested: 1,
                serverVersion: "dev-test",
                markedRuids: ["be3cea0e500304e0"],
                tags: [
                    {
                        ruid: "be3cea0e500304e0",
                        source: "lib://by/audioID/1748955785.taf",
                        boxAudioId: 1634291675,
                        localAudioId: 1748955785,
                        localState: "ready",
                        marked: true,
                    },
                ],
            },
        },
    };
    const decoded = decodeRtnl(record, true);
    expect(decoded.summary).toBe("Server: Synchronisierungsantwort");
    expect(decoded.fields).toEqual(record.event.data);
    expect(decoded.fields).not.toHaveProperty("fullDownload");
    const saved = rtnlSnapshot([record], true, 0, "6CC374F2CBD8");
    expect(saved.entries[0].raw).toEqual(record.event);
    expect(saved.entries[0].fields.serverVersion).toBe("dev-test");
});
