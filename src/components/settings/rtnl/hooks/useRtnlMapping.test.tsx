// SPDX-License-Identifier: GPL-2.0-only
// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useRtnlMapping } from "./useRtnlMapping";
import { fetchRtnlMapping, type RtnlMapping } from "../rtnlMapping";
import { USER_STORAGE_SCOPE_EVENT } from "../../../../utils/storage/userStorage";

vi.mock("../rtnlMapping", () => ({ fetchRtnlMapping: vi.fn() }));

it("loads once across navigation, retries failures and discards stale scope/auth results", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const pending: {
        signal: AbortSignal;
        resolve: (value: RtnlMapping) => void;
        reject: (reason: Error) => void;
    }[] = [];
    vi.mocked(fetchRtnlMapping).mockImplementation(
        (signal) => new Promise((resolve, reject) => pending.push({ signal, resolve, reject })),
    );
    const container = document.createElement("div");
    const root = createRoot(container);
    let state: ReturnType<typeof useRtnlMapping>;
    function Page({ page }: { page: string }) {
        state = useRtnlMapping();
        return <div data-page={page} />;
    }
    const mapping: RtnlMapping = {
        schemaVersion: 1,
        revision: "server",
        log2: {},
        log3: {},
        events: {},
    };
    try {
        await act(async () => root.render(<Page page="tonies" />));
        expect(pending).toHaveLength(1);
        await act(async () => root.render(<Page page="rtnl" />));
        expect(pending).toHaveLength(1);
        await act(async () => pending[0].reject(Error("offline")));
        expect(state!.mappingError).toBe(true);
        expect(state!.mapping).toBeNull();
        await act(async () => state!.reloadMapping());
        expect(pending).toHaveLength(2);
        await act(async () => window.dispatchEvent(new Event(USER_STORAGE_SCOPE_EVENT)));
        expect(pending[1].signal.aborted).toBe(true);
        expect(pending).toHaveLength(3);
        await act(async () => pending[1].resolve(mapping));
        expect(state!.mapping).toBeNull();
        await act(async () => pending[2].resolve(mapping));
        expect(state!.mapping).toEqual(mapping);
        expect(state!.mappingLoading).toBe(false);
        await act(async () => window.dispatchEvent(new Event("teddycloud-auth-required")));
        expect(state!.mapping).toBeNull();
        expect(pending).toHaveLength(3);
    } finally {
        await act(async () => root.unmount());
    }
});
