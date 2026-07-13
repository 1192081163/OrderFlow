import "./styles.css";

import {
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  FluentProvider,
  Input,
  ProgressBar,
  webLightTheme,
} from "@fluentui/react-components";
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import type { EmailExtractionResult } from "../core/extractionService.js";
import type { OrderOrganizerApi } from "../preload/preload.cjs";
import type {
  ExtractionFailure,
  ExtractionResult,
  LocalMailListResult,
  LocalMailMessageSummary,
  LocalMailRuntimeStatus,
  LocalMailSettingsView,
  OutputPaths,
  ProgressEvent,
} from "../shared/types.js";
import {
  canMoveToNextMailDay,
  canMoveToPreviousMailDay,
  filterMessagesForMailDay,
  formatMailDayTitle,
} from "./mailDateFilter.js";
import {
  applyLocalMailEvent,
  connectionBadge,
  emptyMailCopy,
  type LocalMailRendererState,
} from "./localMailViewState.js";

const bridgeMissing = !window.orderOrganizer && window.location.protocol === "file:";
const api: OrderOrganizerApi = window.orderOrganizer ?? createPreviewApi();
const EMAIL_LIST_DAYS = 7;
const BRIDGE_MISSING_MESSAGE = "桌面接口加载失败，请重启应用。";
const STOPPED_STATUS: LocalMailRuntimeStatus = { state: "stopped", detail: "请先登录企业邮箱" };

function App() {
  const [email, setEmail] = useState("");
  const [authCodeInput, setAuthCodeInput] = useState("");
  const [settings, setSettings] = useState<LocalMailSettingsView>({ email: "", hasAuthCode: false, startAtLogin: true });
  const [settingsHidden, setSettingsHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mailLoading, setMailLoading] = useState(false);
  const [summary, setSummary] = useState(bridgeMissing ? "桌面接口未连接" : "尚未开始");
  const [mailView, setMailView] = useState<LocalMailRendererState>({
    list: undefined,
    newMessageUids: new Set(),
    status: STOPPED_STATUS,
  });
  const [mailDayOffset, setMailDayOffset] = useState(0);
  const [selectedMessageUids, setSelectedMessageUids] = useState<Set<string>>(() => new Set());
  const [progress, setProgress] = useState(0);
  const [latestOutputs, setLatestOutputs] = useState<OutputPaths | null>(null);
  const [resultFailures, setResultFailures] = useState<ExtractionFailure[]>([]);
  const [logLines, setLogLines] = useState<string[]>([]);
  const logRef = useRef<HTMLPreElement | null>(null);
  const mailRefreshInFlight = useRef(false);

  const emailMessages = mailView.list?.messages ?? [];
  const runtimeStatus = mailView.status;
  const badge = connectionBadge(runtimeStatus);
  const canUseEmail = settings.hasAuthCode && !bridgeMissing;
  const visibleEmailMessages = useMemo(
    () => filterMessagesForMailDay(emailMessages, mailDayOffset),
    [emailMessages, mailDayOffset],
  );
  const mailDayTitle = formatMailDayTitle(mailDayOffset);
  const canShowPreviousMailDay = canMoveToPreviousMailDay(mailDayOffset, EMAIL_LIST_DAYS);
  const canShowNextMailDay = canMoveToNextMailDay(mailDayOffset);
  const selectedExtractableUids = useMemo(
    () =>
      visibleEmailMessages
        .filter((message) => message.hasExcelAttachments && selectedMessageUids.has(message.uid))
        .map((message) => message.uid),
    [visibleEmailMessages, selectedMessageUids],
  );
  const pendingCount = useMemo(
    () => visibleEmailMessages.filter((message) => message.hasExcelAttachments && !message.extracted).length,
    [visibleEmailMessages],
  );
  const visibleAttachmentCount = useMemo(
    () => visibleEmailMessages.reduce((sum, message) => sum + message.attachmentCount, 0),
    [visibleEmailMessages],
  );
  const visibleMailStatus = mailView.list
    ? `${mailDayTitle}：订单邮件 ${visibleEmailMessages.length} 封，待提取 ${pendingCount} 封，Excel 附件 ${visibleAttachmentCount} 个；近一周扫描 ${mailView.list.scannedMessages} 封`
    : runtimeStatus.detail;

  const appendLog = useCallback((line: string) => {
    const stamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    setLogLines((current) => [...current, `[${stamp}] ${line}`].slice(-200));
  }, []);

  const applyList = useCallback((list: LocalMailListResult): void => {
    setMailView((current) => ({ ...current, list, status: list.status }));
  }, []);

  const loadCachedEmails = useCallback(async (): Promise<void> => {
    applyList(await api.listEmails());
  }, [applyList]);

  const refreshEmails = useCallback(async (): Promise<void> => {
    if (!canUseEmail || mailRefreshInFlight.current) return;
    mailRefreshInFlight.current = true;
    setMailLoading(true);
    try {
      const refreshed = await api.refreshEmails();
      applyList(refreshed);
      appendLog(`邮件列表已刷新：${refreshed.messages.length} 封订单邮件`);
    } catch (error) {
      appendLog(`邮件刷新失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      mailRefreshInFlight.current = false;
      setMailLoading(false);
    }
  }, [appendLog, applyList, canUseEmail]);

  useEffect(() => {
    const removeProgress = api.onProgress((event) => renderProgress(event, appendLog, setProgress));
    const removeMailEvent = api.onLocalMailEvent((event) => {
      setMailView((current) => applyLocalMailEvent(current, event));
    });
    void Promise.all([api.loadMailSettings(), api.listEmails()])
      .then(([saved, list]) => {
        setSettings(saved);
        setEmail(saved.email);
        setSettingsHidden(saved.hasAuthCode);
        setMailView({ list, newMessageUids: new Set(), status: list.status });
      })
      .catch((error) => {
        const detail = `本地邮箱初始化失败：${error instanceof Error ? error.message : String(error)}`;
        appendLog(detail);
        setMailView((current) => ({ ...current, status: { state: "offline", detail } }));
      });
    return () => { removeProgress(); removeMailEvent(); };
  }, [appendLog]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logLines]);

  async function runUiTask(task: () => Promise<void>): Promise<void> {
    if (bridgeMissing) {
      appendLog(`失败：${BRIDGE_MISSING_MESSAGE}`);
      setSummary(BRIDGE_MISSING_MESSAGE);
      return;
    }

    setBusy(true);
    try {
      await task();
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      appendLog(`失败：${messageText}`);
      setResultFailures([{ path: "订单提取", error: messageText }]);
      setSummary(messageText);
    } finally {
      setBusy(false);
    }
  }

  function resetResult(): void {
    setLatestOutputs(null);
    setProgress(0);
    setSummary("正在提取订单");
    setResultFailures([]);
    setLogLines([]);
  }

  function renderExtractionResult(result: ExtractionResult): void {
    setLatestOutputs(hasOutputPaths(result.outputs) ? result.outputs : null);
    setProgress(100);
    setResultFailures(result.failures);
    setSummary(`成功 ${result.rows.length} 个订单，失败 ${result.failures.length} 个，跳过 ${result.skippedFiles.length} 个文件`);
    if (result.outputs.outputDir) {
      appendLog(`输出目录：${result.outputs.outputDir}`);
    }
    result.failures.forEach((failure) => appendLog(`失败 ${failure.path}: ${failure.error}`));
  }

  function renderEmailResult(result: EmailExtractionResult): void {
    appendLog(`已扫描 ${result.emailFetch.scannedMessages} 封邮件，下载 ${result.emailFetch.attachmentCount} 个订单附件`);
    renderExtractionResult(result.extraction);
  }

  async function saveSettings(): Promise<void> {
    await runUiTask(async () => {
      const saved = await api.saveMailSettings({
        email,
        ...(authCodeInput.trim() ? { authCode: authCodeInput.trim() } : {}),
        startAtLogin: true,
      });
      setSettings(saved);
      setEmail(saved.email);
      setAuthCodeInput("");
      setSettingsHidden(saved.hasAuthCode);
      appendLog("邮箱登录成功，授权码已由 Windows DPAPI 加密保存");
      await loadCachedEmails();
    });
  }

  async function reconnectEmail(): Promise<void> {
    await runUiTask(async () => {
      await api.reconnectEmail();
      appendLog("正在重新连接企业邮箱");
    });
  }

  async function extractSelectedEmails(): Promise<void> {
    if (selectedExtractableUids.length === 0) {
      setSummary("请先勾选要提取的邮件。");
      return;
    }
    await extractEmailMessages(selectedExtractableUids);
  }

  async function extractEmailMessages(messageUids: string[]): Promise<void> {
    await runUiTask(async () => {
      resetResult();
      setSummary("正在下载选中邮件附件");
      appendLog(`已选择 ${messageUids.length} 封邮件`);
      appendLog("正在下载选中邮件附件");
      const result = await api.extractEmail({ messageUids, inferManual: true });
      renderEmailResult(result);
      applyList(await api.listEmails());
      setSelectedMessageUids((current) => {
        const next = new Set(current);
        messageUids.forEach((uid) => next.delete(uid));
        return next;
      });
      setMailView((current) => {
        const nextNew = new Set(current.newMessageUids);
        messageUids.forEach((uid) => nextNew.delete(uid));
        return { ...current, newMessageUids: nextNew };
      });
    });
  }

  async function extractLocal(paths: string[]): Promise<void> {
    await runUiTask(async () => {
      resetResult();
      appendLog(`已选择 ${paths.length} 个输入`);
      const result = await api.extractLocal({
        paths,
        recursive: false,
        inferManual: true,
      });
      renderExtractionResult(result);
    });
  }

  async function selectLocalInputs(): Promise<void> {
    const paths = await api.selectLocalInputs();
    if (paths.length > 0) {
      await extractLocal(paths);
    }
  }

  function handleLocalDragOver(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleLocalDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    if (busy || bridgeMissing) {
      return;
    }
    const paths = localPathsFromDrop(event);
    if (paths.length > 0) {
      void extractLocal(paths);
      return;
    }
    setSummary("请拖入本地 Excel 文件或文件夹。");
  }

  async function checkUpdates(): Promise<void> {
    await runUiTask(async () => {
      const result = await api.checkUpdates();
      if (result.updateAvailable && result.downloadUrl) {
        setSummary(`发现新版本 ${result.latestVersion ?? ""}，正在下载新版程序。`);
        appendLog(`正在下载新版程序：${result.assetName ?? "新版 exe"}`);
        const executablePath = await api.downloadAndOpenUpdate();
        appendLog(`新版程序已启动：${executablePath}`);
        setSummary("新版程序已启动，正在关闭当前版本。");
        return;
      }
      if (result.reason === "error") {
        setSummary(`检查更新失败：${result.error ?? "未知错误"}`);
        return;
      }
      if (result.reason === "missing_asset") {
        setSummary(result.error ?? "未找到可下载的 Windows 便携版 exe。");
        return;
      }
      setSummary("当前已经是最新版本。");
    });
  }

  function toggleMessage(uid: string, checked: boolean): void {
    setSelectedMessageUids((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(uid);
      } else {
        next.delete(uid);
      }
      return next;
    });
  }

  function selectPendingMessages(): void {
    setSelectedMessageUids(
      new Set(
        visibleEmailMessages
          .filter((message) => message.hasExcelAttachments && !message.extracted)
          .map((message) => message.uid),
      ),
    );
  }

  function showPreviousMailDay(): void {
    setMailDayOffset((current) => Math.min(current + 1, EMAIL_LIST_DAYS - 1));
  }

  function showNextMailDay(): void {
    setMailDayOffset((current) => Math.max(current - 1, 0));
  }

  function showTodayMailDay(): void {
    setMailDayOffset(0);
  }

  function openLatest(key: keyof OutputPaths): void {
    if (latestOutputs?.[key]) {
      void api.openPath(latestOutputs[key]);
    }
  }

  return (
    <FluentProvider theme={webLightTheme}>
      <main className="app">
        <Card className="mail-command-card">
          <div className="mail-command-layout">
            <div className="mail-command-status">
              <h1>订单提取</h1>
              <div className="connection-row">
                <Badge className="connection-badge" appearance="tint" color={badge.color}>
                  {badge.label}
                </Badge>
                <span className="connected-email">{email || "未设置邮箱"}</span>
              </div>
            </div>
            <div className="mail-command-actions">
              <Button appearance="primary" disabled={busy || mailLoading || !canUseEmail} onClick={() => void refreshEmails()}>
                刷新邮件
              </Button>
              <div className="secondary-command-actions" aria-label="次要操作">
                <Button size="small" appearance="subtle" className="quiet-command-button" disabled={busy || !canUseEmail} onClick={reconnectEmail}>
                  重新连接
                </Button>
                <Button size="small" appearance="subtle" className="quiet-command-button" disabled={busy || bridgeMissing} onClick={checkUpdates}>
                  检查更新
                </Button>
                <Button
                  size="small"
                  appearance="subtle"
                  className="quiet-command-button"
                  disabled={busy || bridgeMissing}
                  onClick={() => setSettingsHidden(false)}
                >
                  修改邮箱设置
                </Button>
              </div>
            </div>
          </div>
        </Card>

        <div className={`mail-runtime-banner ${runtimeStatus.state === "offline" ? "offline" : runtimeStatus.state === "attention_required" ? "attention" : ""}`}>
          {runtimeStatus.detail}
        </div>

        <div className="workspace">
          <Card className="surface mail-list-panel">
            <div className="section-heading compact-heading">
              <div className="mail-heading-copy">
                <div className="mail-title-row">
                  <div className="section-title">{mailDayTitle}</div>
                  <div className="mail-day-controls" aria-label="邮件日期切换">
                    <Button
                      size="small"
                      className="mail-day-arrow"
                      aria-label="上一天"
                      title="上一天"
                      disabled={busy || mailLoading || !canShowPreviousMailDay}
                      onClick={showPreviousMailDay}
                    >
                      ←
                    </Button>
                    <Button
                      size="small"
                      className="mail-day-arrow"
                      aria-label="下一天"
                      title="下一天"
                      disabled={busy || mailLoading || !canShowNextMailDay}
                      onClick={showNextMailDay}
                    >
                      →
                    </Button>
                    <Button size="small" disabled={busy || mailLoading || mailDayOffset === 0} onClick={showTodayMailDay}>
                      回到今天
                    </Button>
                  </div>
                </div>
                <div className="section-subtitle">固定显示最近 7 天，本机后台实时监听。</div>
              </div>
              <Badge appearance="tint" color={pendingCount > 0 ? "warning" : "success"}>
                待提取 {pendingCount}
              </Badge>
            </div>
            <div className="mail-toolbar">
              <span className="mail-status">{mailLoading ? "正在刷新..." : visibleMailStatus}</span>
              <div className="mail-toolbar-actions">
                <Button size="small" disabled={busy || mailLoading || pendingCount === 0} onClick={selectPendingMessages}>
                  全选待提取
                </Button>
                <Button size="small" disabled={busy || selectedMessageUids.size === 0} onClick={() => setSelectedMessageUids(new Set())}>
                  清空
                </Button>
              </div>
            </div>
            <div className="mail-list" aria-label={`${mailDayTitle}列表`}>
              {visibleEmailMessages.length === 0 ? (
                <div className="empty-mail-list">
                  {emailMessages.length === 0
                    ? emptyMailCopy(settings.hasAuthCode, runtimeStatus.state === "offline")
                    : `${mailDayTitle}没有订单邮件。`}
                </div>
              ) : (
                visibleEmailMessages.map((message) => {
                  const extracted = message.extracted;
                  const pending = message.hasExcelAttachments && !extracted;
                  const newlyArrived = pending && mailView.newMessageUids.has(message.uid);
                  const selected = selectedMessageUids.has(message.uid);
                  const rowClass = [
                    "mail-row",
                    newlyArrived ? "new-mail" : "",
                    pending ? "pending" : "",
                    extracted ? "extracted" : "",
                    !message.hasExcelAttachments ? "no-excel" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <div key={message.uid} className={rowClass}>
                      <Checkbox
                        aria-label={`选择邮件 ${message.subject}`}
                        checked={selected}
                        disabled={busy || !message.hasExcelAttachments}
                        onChange={(_, data) => toggleMessage(message.uid, Boolean(data.checked))}
                      />
                      <div className="mail-row-body">
                        <div className="mail-row-title">
                          <span className="mail-subject">{message.subject || "(无主题)"}</span>
                          {renderMessageBadge(message, extracted, newlyArrived)}
                        </div>
                        <div className="mail-meta">
                          <span>{formatMessageDate(message.date)}</span>
                          <span>{message.from || "未知发件人"}</span>
                        </div>
                        <div className="attachment-line">
                          {message.hasExcelAttachments ? message.excelAttachmentNames.join(" / ") : "无 Excel 候选附件"}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>

          <div className="side-column">
            {!settingsHidden && (
              <Card id="settingsPanel" className="surface settings-card">
                <div className="section-heading">
                  <div>
                    <div className="section-title">企业微信邮箱</div>
                    <div className="section-subtitle">邮箱授权码使用 Windows DPAPI 加密保存在本机。</div>
                  </div>
                </div>
                <div className="settings-grid">
                  <Field label="邮箱">
                    <Input autoComplete="username" placeholder="name@company.com" value={email} onChange={(_, data) => setEmail(data.value)} />
                  </Field>
                  <Field label="授权码">
                    <Input
                      autoComplete="current-password"
                      placeholder={settings.hasAuthCode ? "未修改时可留空" : "邮箱客户端授权码"}
                      type="password"
                      value={authCodeInput}
                      onChange={(_, data) => setAuthCodeInput(data.value)}
                    />
                  </Field>
                </div>
                <div className="row-actions">
                  <Button appearance="primary" disabled={busy || bridgeMissing} onClick={saveSettings}>
                    保存并登录
                  </Button>
                  <Button disabled={busy || !canUseEmail} onClick={reconnectEmail}>
                    重新连接
                  </Button>
                </div>
              </Card>
            )}

            <Card className="surface action-card">
              <div className="section-heading">
                <div>
                  <div className="section-title">提取操作</div>
                  <div className="section-subtitle">先选邮件，再提取附件里的订单。</div>
                </div>
              </div>
              <div className="primary-actions">
                <Button
                  appearance="primary"
                  className="large-action wide-button"
                  disabled={busy || selectedExtractableUids.length === 0}
                  onClick={extractSelectedEmails}
                >
                  {selectedExtractableUids.length > 0 ? `提取选中 ${selectedExtractableUids.length} 封` : "提取选中邮件"}
                </Button>
              </div>
              <div className="local-extraction-actions" onDragOver={handleLocalDragOver} onDrop={handleLocalDrop}>
                <Button className="wide-button" disabled={busy || bridgeMissing} onClick={selectLocalInputs}>
                  本地提取
                </Button>
                <div className="local-drop-hint">拖入 Excel 文件或文件夹</div>
              </div>
            </Card>

            <Card className="surface result-panel">
              <div className="result-header">
                <div>
                  <div className="section-title">订单提取结果</div>
                  <div id="summaryText" className="summary">
                    {summary}
                  </div>
                  {resultFailures.length > 0 && (
                    <div className="failure-list">
                      <div className="failure-title">失败原因</div>
                      {resultFailures.map((failure) => (
                        <div className="failure-item" key={`${failure.path}:${failure.error}`}>
                          <span className="failure-path">{failure.path}</span>
                          <span className="failure-error">{failure.error}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {latestOutputs && (
                  <div id="outputButtons" className="output-buttons">
                    <Button size="small" onClick={() => openLatest("outputDir")}>
                      打开输出目录
                    </Button>
                    <Button size="small" onClick={() => openLatest("xlsxOutput")}>
                      打开 Excel
                    </Button>
                  </div>
                )}
              </div>
              <div className="progress-area">
                <ProgressBar className="progress-bar" value={progress} max={100} data-empty={progress === 0} />
              </div>
              <pre ref={logRef} id="logOutput" className="log">
                {logLines.length > 0 ? `${logLines.join("\n")}\n` : ""}
              </pre>
            </Card>
          </div>
        </div>
      </main>
    </FluentProvider>
  );
}

function renderProgress(
  event: ProgressEvent,
  appendLog: (line: string) => void,
  setProgress: (value: number) => void,
): void {
  const percent = event.total === 0 ? 0 : Math.round((event.index / event.total) * 100);
  setProgress(percent);
  const label = event.status === "running" ? "正在提取" : event.status === "completed" ? "完成" : "失败";
  appendLog(`[${event.index}/${event.total}] ${label} ${event.filename}`);
}

function hasOutputPaths(outputs: OutputPaths): boolean {
  return Boolean(outputs.outputDir || outputs.xlsxOutput || outputs.csvOutput || outputs.auditOutput);
}

function renderMessageBadge(message: LocalMailMessageSummary, extracted: boolean, newlyArrived = false) {
  if (!message.hasExcelAttachments) {
    return (
      <Badge appearance="tint" color="subtle">
        无附件
      </Badge>
    );
  }
  if (newlyArrived) {
    return (
      <Badge appearance="tint" color="danger">
        新邮件
      </Badge>
    );
  }
  if (extracted) {
    return (
      <Badge appearance="tint" color="success">
        已提取
      </Badge>
    );
  }
  return (
    <Badge appearance="tint" color="warning">
      待提取
    </Badge>
  );
}

function localPathsFromDrop(event: DragEvent<HTMLDivElement>): string[] {
  const paths = Array.from(event.dataTransfer.files)
    .map((file) => (file as File & { path?: string }).path ?? "")
    .filter((path) => path.trim().length > 0);
  return [...new Set(paths)];
}

function formatMessageDate(date: string | undefined): string {
  if (!date) {
    return "时间未知";
  }
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) {
    return "时间未知";
  }
  return value.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function createPreviewApi(): OrderOrganizerApi {
  const outputs: OutputPaths = {
    outputDir: "/preview/orders",
    csvOutput: "/preview/orders/extracted_job_rows.csv",
    xlsxOutput: "/preview/orders/订单整理结果.xlsx",
    auditOutput: "/preview/orders/audit.csv",
  };
  const extraction: ExtractionResult = {
    inputFiles: ["/preview/orders/order.xlsx"],
    rows: [],
    skippedFiles: [],
    failures: [],
    outputs,
  };
  const previewList: LocalMailListResult = {
    days: 7,
    scannedMessages: 2,
    orderAttachmentCount: 1,
    nonOrderExcelAttachmentCount: 0,
    status: { state: "connected", detail: "预览：本地邮箱已连接" },
    messages: [
      {
        uid: "preview-2",
        subject: "今日订单附件",
        from: "Orders <orders@example.com>",
        date: new Date().toISOString(),
        attachmentCount: 1,
        excelAttachmentNames: ["today-order.xlsx"],
        hasExcelAttachments: true,
        extracted: false,
      },
    ],
  };

  return {
    loadMailSettings: async () => ({ email: "", hasAuthCode: false, startAtLogin: true }),
    saveMailSettings: async (input) => ({ email: input.email.trim(), hasAuthCode: Boolean(input.authCode), startAtLogin: true }),
    selectLocalInputs: async () => ["/preview/orders/order.xlsx"],
    listEmails: async () => previewList,
    refreshEmails: async () => previewList,
    reconnectEmail: async () => undefined,
    extractLocal: async () => extraction,
    extractEmail: async () => ({
      emailFetch: {
        files: ["/preview/orders/order.xlsx"],
        scannedMessages: 1,
        attachmentCount: 1,
        downloadDir: "/preview/orders",
      },
      extraction,
    }),
    onLocalMailEvent: () => () => undefined,
    checkUpdates: async () => ({
      updateAvailable: false,
      currentVersion: "preview",
      reason: "current",
    }),
    downloadAndOpenUpdate: async () => "/preview/downloads/orderflow-desktop-windows.exe",
    openPath: async () => undefined,
    onProgress: () => () => undefined,
  };
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found.");
}

createRoot(rootElement).render(<App />);
