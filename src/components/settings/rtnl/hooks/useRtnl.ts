import { useCallback, useEffect, useState } from "react";
import { subscribeToEvents, type LiveEvent } from "../../../../goteddycloud/liveStream";

export const useRtnl = () => {
    const [logEntries, setLogEntries] = useState<string[]>([]);

    const hexToStr = useCallback((hex: string) => {
        let str = "";
        for (let i = 0; i < hex.length; i += 2) {
            const pair = hex.substring(i, i + 2);
            const charCode = parseInt(pair, 16);
            if (charCode >= 32 && charCode <= 126) {
                str += String.fromCharCode(charCode);
            } else {
                str += ".";
            }
        }
        return str;
    }, []);

    const littleEndianToNum = useCallback((hex: string) => {
        let bigEndianHex = "";
        for (let i = 0; i < hex.length; i += 2) {
            bigEndianHex = hex.substring(i, i + 2) + bigEndianHex;
        }

        let num = parseInt(bigEndianHex, 16);
        const maxVal = 2 ** 31;

        if (num >= maxVal) {
            num = num - 2 * maxVal;
        }
        return num;
    }, []);

    useEffect(() => {
        const handlers = new Map<string, (event: LiveEvent) => void>();

        const appendLog = (entry: string) => {
            setLogEntries((prev) => [...prev.slice(-1999), entry]);
        };

        const functionHandlers: { [key: string]: (payload: string) => void } = {
            /* ESP32 box events */
            "15-15452": (payload: string) => {
                if (payload.length === 16) {
                    const rearrangedPayload = payload.slice(8) + payload.slice(0, 8);
                    appendLog(`UnknownTag | ${rearrangedPayload}`);
                } else {
                    console.log(`Incorrect payload length for '${payload}'. Unable to rearrange.`);
                }
            },
            "15-16065": (payload: string) => {
                if (payload.length === 16) {
                    const rearrangedPayload = payload.slice(8) + payload.slice(0, 8);
                    appendLog(`KnownTag | ${rearrangedPayload}`);
                } else {
                    console.log(`Incorrect payload length for '${payload}'. Unable to rearrange.`);
                }
            },
            "12-15427": (payload: string) => {
                if (payload.length === 8) {
                    const value = littleEndianToNum(payload);
                    appendLog(`UpsideState | ${value}`);
                } else {
                    console.log(`Incorrect payload length for '${payload}'. Unable to rearrange.`);
                }
            },
            "12-15426": (payload: string) => {
                if (payload.length === 8) {
                    const value = littleEndianToNum(payload);
                    appendLog(`UprightState | ${value}`);
                } else {
                    console.log(`Incorrect payload length for '${payload}'. Unable to rearrange.`);
                }
            },
        };

        handlers.set("pressed", (event: LiveEvent) => {
            try {
                const data = event;
                appendLog("Pressed: " + data.data);
            } catch (err) {
                console.error("Error parsing 'pressed' event:", err);
            }
        });

        handlers.set("rtnl-raw-log2", (event: LiveEvent) => {
            try {
                const data = event;
                const entryData = data.data as Record<string, any>;

                const funcGroup = entryData.function_group.toString().padStart(2, " ");
                const func = entryData.function;
                const payload = entryData.field6;

                const newLogEntry =
                    "Raw2 |" +
                    " #" +
                    entryData.sequence +
                    " Uptime: " +
                    entryData.uptime +
                    " Func: " +
                    funcGroup +
                    "-" +
                    func +
                    " Payload: '" +
                    payload +
                    "'" +
                    " ASCII: '" +
                    hexToStr(payload) +
                    "'";

                appendLog(newLogEntry);

                const funcKey = `${funcGroup}-${func}`;
                if (functionHandlers[funcKey]) {
                    functionHandlers[funcKey](payload);
                }
            } catch (err) {
                console.error("Error parsing 'rtnl-raw-log2' event:", err);
            }
        });

        handlers.set("rtnl-raw-log3", (event: LiveEvent) => {
            try {
                const data = event;
                const entryData = data.data as Record<string, any>;
                appendLog(
                    "Raw3 | Datetime: " + entryData.datetime + " Unknown: " + entryData.field2,
                );
            } catch (err) {
                console.error("Error parsing 'rtnl-raw-log3' event:", err);
            }
        });

        return subscribeToEvents((event) => handlers.get(event.type)?.(event));
    }, [hexToStr, littleEndianToNum]);

    const clearRtnl = useCallback(() => {
        setLogEntries([]);
    }, []);

    return {
        logEntries,
        clearRtnl,
    };
};
