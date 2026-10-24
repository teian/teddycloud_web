// SPDX-License-Identifier: GPL-2.0-only
import { defaultAPIConfig } from "../../../config/defaultApiConfig";

export type RtnlLabel = { en: string; de?: string };
export type RtnlField = { name: string; type: string; offset?: number };
export type RtnlDefinition = {
    label: RtnlLabel;
    minBytes: number;
    fields: RtnlField[];
    interpretation?: string;
    rawValues?: boolean;
};
export type RtnlMapping = {
    schemaVersion: 1;
    revision: string;
    log2: Record<string, RtnlDefinition>;
    log3: Record<string, RtnlLabel>;
    events: Record<
        string,
        { label: RtnlLabel; selector?: string; variants?: Record<string, RtnlLabel> }
    >;
};

const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
const label = (value: unknown): value is RtnlLabel =>
    object(value) &&
    typeof value.en === "string" &&
    (value.de === undefined || typeof value.de === "string");
const offset = (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 65535;

export function parseRtnlMapping(value: unknown): RtnlMapping {
    if (
        !object(value) ||
        value.schemaVersion !== 1 ||
        typeof value.revision !== "string" ||
        !value.revision ||
        !object(value.log2) ||
        !object(value.log3) ||
        !object(value.events)
    )
        throw Error("Unsupported RTNL mapping");
    for (const definition of Object.values(value.log2)) {
        if (
            !object(definition) ||
            !label(definition.label) ||
            !offset(definition.minBytes) ||
            !Array.isArray(definition.fields) ||
            (definition.interpretation !== undefined &&
                typeof definition.interpretation !== "string") ||
            (definition.rawValues !== undefined && typeof definition.rawValues !== "boolean")
        )
            throw Error("Invalid RTNL definition");
        for (const field of definition.fields) {
            if (
                !object(field) ||
                typeof field.name !== "string" ||
                !/^[A-Za-z][A-Za-z0-9]*$/.test(field.name) ||
                ["constructor", "prototype"].includes(field.name) ||
                typeof field.type !== "string" ||
                (field.offset !== undefined && !offset(field.offset))
            )
                throw Error("Invalid RTNL field");
        }
    }
    if (!Object.values(value.log3).every(label)) throw Error("Invalid RTNL labels");
    for (const definition of Object.values(value.events)) {
        if (
            !object(definition) ||
            !label(definition.label) ||
            (definition.selector !== undefined && typeof definition.selector !== "string") ||
            (definition.variants !== undefined &&
                (!object(definition.variants) || !Object.values(definition.variants).every(label)))
        )
            throw Error("Invalid RTNL event definition");
    }
    return value as RtnlMapping;
}

export async function fetchRtnlMapping(signal: AbortSignal): Promise<RtnlMapping> {
    const config = defaultAPIConfig();
    const response = await (config.fetchApi ?? fetch)(config.basePath + "/api/rtnl/mapping", {
        signal,
        cache: "no-cache",
        headers: { Accept: "application/json" },
    });
    if (!response.ok) throw Error("RTNL mapping unavailable");
    const data = await response.text();
    if (data.length > 1024 * 1024) throw Error("RTNL mapping too large");
    return parseRtnlMapping(JSON.parse(data));
}
