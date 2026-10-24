// SPDX-License-Identifier: GPL-2.0-only
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Typography, Button, Segmented, Select, Space, theme } from "antd";
import { useTranslation } from "react-i18next";
import { useRtnl } from "./hooks/useRtnl";
import { decodeRtnl, formatDecoded, rtnlSnapshot } from "./rtnlDecoder";
import { useGoText } from "../../../goteddycloud/text";

function download(contents: string, extension: "json" | "txt") {
    const url = URL.createObjectURL(
        new Blob([contents], {
            type: extension === "json" ? "application/json" : "text/plain;charset=utf-8",
        }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `goteddycloud-rtnl-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const RtnlConsole: React.FC = () => {
    const { t, i18n } = useTranslation();
    const text = useGoText();
    const { token } = theme.useToken();
    const { entries, dropped, paused, togglePause, clearRtnl } = useRtnl();
    const [mode, setMode] = useState("decoded");
    const [box, setBox] = useState("");
    const german = i18n.language.startsWith("de");
    const logListRef = useRef<HTMLDivElement>(null);
    const decoded = useMemo(
        () => entries.map((entry) => decodeRtnl(entry, german)),
        [entries, german],
    );
    const boxes = useMemo(
        () => [...new Set(decoded.map((entry) => entry.box).filter(Boolean))].sort(),
        [decoded],
    );
    const visible = decoded.filter((entry) => !box || entry.box === box);
    useEffect(() => {
        if (box && !boxes.includes(box)) setBox("");
    }, [box, boxes]);
    const lines = visible.map((entry) =>
        mode === "raw"
            ? `${entry.receivedAt}${entry.box ? ` [${entry.box}]` : ""} ${entry.rawText}`
            : formatDecoded(entry) + (mode === "both" ? "\n  " + entry.rawText : ""),
    );
    useEffect(() => {
        if (!paused && logListRef.current)
            logListRef.current.scrollTop = logListRef.current.scrollHeight;
    }, [entries, paused]);
    const save = (extension: "json" | "txt") => {
        const snapshot = rtnlSnapshot(entries, german, dropped, box);
        download(
            extension === "json"
                ? JSON.stringify(snapshot, null, 2)
                : `goTeddyCloud RTNL | ${snapshot.createdAt} | dropped=${dropped}\n\n` +
                      snapshot.entries
                          .map((entry) => formatDecoded(entry) + "\n  " + entry.rawText)
                          .join("\n"),
            extension,
        );
    };
    const dark = token.colorBgBase === "#000" || token.colorBgBase === "#000000";
    return (
        <>
            <h1>{t("settings.rtnl.title")}</h1>
            <Typography.Paragraph>{text("rtnlHelp")}</Typography.Paragraph>
            <Space wrap style={{ marginBottom: 12 }}>
                <Segmented
                    value={mode}
                    onChange={(value) => setMode(String(value))}
                    options={[
                        { label: text("rtnlDecoded"), value: "decoded" },
                        { label: "Raw", value: "raw" },
                        { label: text("rtnlBoth"), value: "both" },
                    ]}
                />
                <Select
                    aria-label={text("rtnlBox")}
                    style={{ minWidth: 190 }}
                    value={box}
                    onChange={setBox}
                    options={[
                        { label: text("rtnlAllBoxes"), value: "" },
                        ...boxes.map((value) => ({ label: value, value })),
                    ]}
                />
                <Button onClick={togglePause}>{text(paused ? "rtnlResume" : "rtnlPause")}</Button>
                <Button onClick={() => save("json")} disabled={!visible.length}>
                    {text("rtnlSnapshot")}
                </Button>
                <Button onClick={() => save("txt")} disabled={!visible.length}>
                    {text("rtnlText")}
                </Button>
                <Button onClick={clearRtnl}>{t("settings.rtnl.clear")}</Button>
            </Space>
            <Typography.Paragraph type="secondary">
                {visible.length} {text("rtnlEntries")}
                {dropped > 0 ? ` · ${dropped} ${text("rtnlDropped")}` : ""}
            </Typography.Paragraph>
            <div
                className="rtnl-log-container"
                ref={logListRef}
                style={{
                    minHeight: "max(40vh, 333px)",
                    maxHeight: "65vh",
                    overflow: "auto",
                    backgroundColor: token.colorBgContainer,
                    scrollbarColor: `${token.colorTextDescription} ${token.colorBgContainer}`,
                }}
            >
                <SyntaxHighlighter
                    language="log"
                    style={dark ? oneDark : oneLight}
                    wrapLongLines={mode !== "raw"}
                    codeTagProps={{
                        style: {
                            whiteSpace: mode === "raw" ? "pre" : "pre-wrap",
                            overflowWrap: "anywhere",
                        },
                    }}
                    customStyle={{
                        borderRadius: 0,
                        margin: 0,
                        border: "none",
                        width: mode === "raw" ? "max-content" : "100%",
                        boxSizing: "border-box",
                        minWidth: "100%",
                        minHeight: "max(38vh, 320px)",
                    }}
                >
                    {lines.join("\n")}
                </SyntaxHighlighter>
            </div>
        </>
    );
};
