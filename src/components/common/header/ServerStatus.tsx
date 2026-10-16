import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Space, Tag, Tooltip, theme } from "antd";
import { CheckCircleOutlined, CloseCircleOutlined, LockOutlined } from "@ant-design/icons";

import { defaultAPIConfig } from "../../../config/defaultApiConfig";
import { BoxineApi } from "../../../api";
import { readCloudStatus } from "../../../goteddycloud/api";

import { HiddenDesktop, HiddenMobile } from "../StyledComponents";
import { useTeddyCloud } from "../../../provider/TeddyCloudProvider";

const boxineApi = new BoxineApi(defaultAPIConfig());

const { useToken } = theme;

export const ServerStatus = () => {
    const { t } = useTranslation();
    const { token } = useToken();
    const { fetchCloudStatus, setToniesCloudAvailable } = useTeddyCloud();

    const [boxineStatus, setBoxineStatus] = useState(false);
    const [boxineEnabledStatus, setBoxineEnabledStatus] = useState(true);
    const [teddyStatus, setTeddyStatus] = useState(false);

    const fetchTeddyStatus = useCallback(async () => {
        try {
            const timeRequest = (await boxineApi.v1TimeGet()) as string;
            setTeddyStatus(timeRequest.length === 10);
        } catch {
            setTeddyStatus(false);
        }
    }, []);

    const fetchBoxineStatus = useCallback(async () => {
        try {
            const status = await readCloudStatus();
            setBoxineEnabledStatus(status.enabled);
            setBoxineStatus(status.available);
        } catch {
            setBoxineStatus(false);
        }
    }, []);

    const fetchCloudStatusUsingTimeRequests = useCallback(async () => {
        await Promise.all([fetchTeddyStatus(), fetchBoxineStatus()]);
    }, [fetchTeddyStatus, fetchBoxineStatus]);

    useEffect(() => {
        fetchCloudStatusUsingTimeRequests();
    }, [fetchCloudStatusUsingTimeRequests, fetchCloudStatus]);

    useEffect(() => {
        setToniesCloudAvailable(boxineStatus);
    }, [boxineStatus, setToniesCloudAvailable]);

    const boxineBgColor = boxineEnabledStatus ? (boxineStatus ? "#87d068" : "#f50") : "#faad14";

    const teddyBgColor = teddyStatus ? "#87d068" : "#f50";

    const commonTagStyle: React.CSSProperties = {
        cursor: "help",
        border: 0,
        color: token.colorTextLightSolid,
    };

    return (
        <Space>
            <Tooltip
                title={
                    boxineEnabledStatus
                        ? boxineStatus
                            ? t("server.boxineStatusOnline")
                            : t("server.boxineStatusOffline")
                        : t("server.boxineDisabled")
                }
            >
                <Tag
                    icon={
                        boxineEnabledStatus ? (
                            boxineStatus ? (
                                <CheckCircleOutlined />
                            ) : (
                                <CloseCircleOutlined />
                            )
                        ) : (
                            <LockOutlined />
                        )
                    }
                    style={{
                        ...commonTagStyle,
                        color: "#001529",
                        backgroundColor: boxineBgColor,
                    }}
                >
                    <HiddenDesktop>B</HiddenDesktop>
                    <HiddenMobile>Boxine</HiddenMobile>
                </Tag>
            </Tooltip>

            <Tooltip
                title={
                    teddyStatus
                        ? t("server.teddycloudStatusOnline")
                        : t("server.teddycloudStatusOffline")
                }
            >
                <Tag
                    icon={teddyStatus ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                    style={{
                        ...commonTagStyle,
                        backgroundColor: teddyBgColor,
                        color: "#001529",
                        marginRight: 8,
                    }}
                >
                    <HiddenDesktop>TC</HiddenDesktop>
                    <HiddenMobile>TeddyCloud</HiddenMobile>
                </Tag>
            </Tooltip>
        </Space>
    );
};
