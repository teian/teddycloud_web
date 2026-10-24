// SPDX-License-Identifier: GPL-2.0-only
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Typography, Button, Segmented, Select, Space, theme } from "antd";
import { useTranslation } from "react-i18next";
import { useRtnl } from "./hooks/useRtnl";
import { formatDecoded, rtnlSnapshot, type RecordedRtnlEvent } from "./rtnlDecoder";
import { rtnlBox, rtnlWindow, type RtnlMode } from "./rtnlView";
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
    const [mode, setMode] = useState<RtnlMode>("decoded");
    const [box, setBox] = useState("");
    const [anchor, setAnchor] = useState<RecordedRtnlEvent | null>(null);
    const german = i18n.language.startsWith("de");
    const logListRef = useRef<HTMLDivElement>(null);
    const boxes = useMemo(
        () => [...new Set(entries.map(rtnlBox).filter(Boolean))].sort(),
        [entries],
    );
    const visible = useMemo(
        () => entries.filter((entry) => !box || rtnlBox(entry) === box),
        [entries, box],
    );
    const view = useMemo(
        () => rtnlWindow(visible, german, mode, anchor),
        [visible, german, mode, anchor],
    );
    useEffect(() => {
        if (box && !boxes.includes(box)) setBox("");
    }, [box, boxes]);
    useEffect(() => {
        if (!paused && !anchor && logListRef.current)
            logListRef.current.scrollTop = logListRef.current.scrollHeight;
    }, [view.text, paused, anchor]);
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
    return (
        <>
            <h1>{t("settings.rtnl.title")}</h1>
            <Typography.Paragraph>{text("rtnlHelp")}</Typography.Paragraph>
            <Space wrap style={{ marginBottom: 12 }}>
                <Segmented
                    value={mode}
                    onChange={(value) => setMode(value as RtnlMode)}
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
                    onChange={(value) => {
                        setBox(value);
                        setAnchor(null);
                    }}
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
                {visible.length ? `${view.start + 1}–${view.end} / ` : ""}
                {visible.length} {text("rtnlEntries")}
                {dropped > 0 ? ` · ${dropped} ${text("rtnlDropped")}` : ""}
                {view.truncated ? ` · ${text("rtnlFullInSnapshot")}` : ""}
            </Typography.Paragraph>
            <Space wrap style={{ marginBottom: 12 }}>
                <Button
                    disabled={view.start === 0}
                    onClick={() => setAnchor(visible[view.start - 1])}
                >
                    {text("rtnlOlder")}
                </Button>
                <Button
                    disabled={view.end === visible.length}
                    onClick={() => {
                        const next = rtnlWindow(visible, german, mode, null, view.end);
                        setAnchor(next.end === visible.length ? null : visible[next.end - 1]);
                    }}
                >
                    {text("rtnlNewer")}
                </Button>
                <Button disabled={!anchor} onClick={() => setAnchor(null)}>
                    {text("rtnlLatest")}
                </Button>
            </Space>
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
                <pre
                    style={{
                        margin: 0,
                        padding: 12,
                        color: token.colorText,
                        fontSize: 12,
                        lineHeight: 1.5,
                        whiteSpace: mode === "raw" ? "pre" : "pre-wrap",
                        overflowWrap: "anywhere",
                        width: mode === "raw" ? "max-content" : "100%",
                        boxSizing: "border-box",
                        minWidth: "100%",
                        minHeight: "max(38vh, 320px)",
                    }}
                >
                    {view.text}
                </pre>
            </div>
        </>
    );
};
