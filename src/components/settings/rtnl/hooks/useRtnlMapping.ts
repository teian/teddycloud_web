// SPDX-License-Identifier: GPL-2.0-only
import { useCallback, useEffect, useState } from "react";
import { USER_STORAGE_SCOPE_EVENT } from "../../../../utils/storage/userStorage";
import { fetchRtnlMapping, type RtnlMapping } from "../rtnlMapping";

// One request per recorder session, independent of console navigation or log
// volume. Scope/auth changes cancel stale requests and discard the old mapping.
export function useRtnlMapping() {
    const [mapping, setMapping] = useState<RtnlMapping | null>(null);
    const [mappingLoading, setLoading] = useState(true);
    const [mappingError, setError] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const reloadMapping = useCallback(() => setAttempt((value) => value + 1), []);
    useEffect(() => {
        const abort = new AbortController();
        setMapping(null);
        setLoading(true);
        setError(false);
        void fetchRtnlMapping(abort.signal)
            .then((value) => {
                if (!abort.signal.aborted) setMapping(value);
            })
            .catch(() => {
                if (!abort.signal.aborted) setError(true);
            })
            .finally(() => {
                if (!abort.signal.aborted) setLoading(false);
            });
        const reset = () => {
            abort.abort();
            setMapping(null);
            setError(false);
            setLoading(false);
        };
        const changed = () => {
            reset();
            reloadMapping();
        };
        window.addEventListener(USER_STORAGE_SCOPE_EVENT, changed);
        window.addEventListener("teddycloud-auth-required", reset);
        return () => {
            abort.abort();
            window.removeEventListener(USER_STORAGE_SCOPE_EVENT, changed);
            window.removeEventListener("teddycloud-auth-required", reset);
        };
    }, [attempt, reloadMapping]);
    return { mapping, mappingLoading, mappingError, reloadMapping };
}
