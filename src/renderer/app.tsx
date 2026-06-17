import "./styles.css";

import {
  Badge,
  Button,
  Card,
  Checkbox,
  Divider,
  Field,
  FluentProvider,
  Input,
  ProgressBar,
  webLightTheme,
} from "@fluentui/react-components";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import type { EmailExtractionResult } from "../core/extractionService.js";
import type { OrderOrganizerApi } from "../preload/preload.cjs";
import type { EmailMessageSummary, ExtractionResult, OutputPaths, ProgressEvent } from "../shared/types.js";
import {
  buildNewOrderEmailNotification,
  findNewPendingOrderMessages,
  mergeSeenMessageUids,
} from "./mailNotifications.js";

const bridgeMissing = !window.orderOrganizer && window.location.protocol === "file:";
const api: OrderOrganizerApi = window.orderOrganizer ?? createPreviewApi();
const DEFAULT_IMAP_SERVER = "imap.exmail.qq.com";
const DEFAULT_IMAP_PORT = 993;
const EMAIL_LIST_DAYS = 7;
const AUTO_REFRESH_MS = 5 * 60 * 1000;
const BRIDGE_MISSING_MESSAGE = "桌面接口加载失败，请重启应用。";

function App() {
  const [email, setEmail] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [recursive, setRecursive] = useState(false);
  const [inferManual, setInferManual] = useState(true);
  const [settingsHidden, setSettingsHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mailLoading, setMailLoading] = useState(false);
  const [status, setStatus] = useState(bridgeMissing ? BRIDGE_MISSING_MESSAGE : "本地处理企业微信邮箱附件和订单 Excel");
  const [summary, setSummary] = useState(bridgeMissing ? "桌面接口未连接" : "尚未开始");
  const [mailStatus, setMailStatus] = useState("保存邮箱后加载近一周邮件");
  const [lastRefreshLabel, setLastRefreshLabel] = useState("");
  const [emailMessages, setEmailMessages] = useState<EmailMessageSummary[]>([]);
  const [selectedMessageUids, setSelectedMessageUids] = useState<Set<string>>(() => new Set());
  const [extractedMessageUids, setExtractedMessageUids] = useState<Set<string>>(() => new Set());
  const [newMessageUids, setNewMessageUids] = useState<Set<string>>(() => new Set());
  const [progress, setProgress] = useState(0);
  const [latestOutputs, setLatestOutputs] = useState<OutputPaths | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const logRef = useRef<HTMLPreElement | null>(null);
  const mailRefreshInFlight = useRef(false);
  const seenMessageUids = useRef<Set<string>>(new Set());
  const hasLoadedMailbox = useRef(false);
  const mailboxKey = useRef("");

  const canUseEmail = Boolean(email.trim() && authCode.trim() && !bridgeMissing);
  const selectedExtractableUids = useMemo(
    () =>
      emailMessages
        .filter((message) => message.hasExcelAttachments && selectedMessageUids.has(message.uid))
        .map((message) => message.uid),
    [emailMessages, selectedMessageUids],
  );
  const pendingCount = useMemo(
    () => emailMessages.filter((message) => message.hasExcelAttachments && !extractedMessageUids.has(message.uid)).length,
    [emailMessages, extractedMessageUids],
  );

  const appendLog = useCallback((line: string) => {
    const stamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    setLogLines((current) => [...current, `[${stamp}] ${line}`].slice(-200));
  }, []);

  const refreshEmails = useCallback(
    async (mode: "manual" | "auto" = "manual", override?: { email: string; authCode: string }): Promise<void> => {
      const currentEmail = (override?.email ?? email).trim();
      const currentAuthCode = (override?.authCode ?? authCode).trim();

      if (!currentEmail || !currentAuthCode) {
        setMailStatus("填写邮箱和授权码后可加载近一周邮件");
        return;
      }
      if (bridgeMissing || mailRefreshInFlight.current) {
        return;
      }

      const currentMailboxKey = currentEmail.toLowerCase();
      if (mailboxKey.current !== currentMailboxKey) {
        mailboxKey.current = currentMailboxKey;
        seenMessageUids.current = new Set();
        hasLoadedMailbox.current = false;
        setNewMessageUids(new Set());
      }

      mailRefreshInFlight.current = true;
      setMailLoading(true);
      if (mode === "manual") {
        setMailStatus("正在刷新近一周邮件");
      }

      try {
        const result = await api.listEmails({
          email: currentEmail,
          authCode: currentAuthCode,
          server: DEFAULT_IMAP_SERVER,
          port: DEFAULT_IMAP_PORT,
          days: EMAIL_LIST_DAYS,
        });
        const sortedMessages = sortMessages(result.messages);
        const validUids = new Set(sortedMessages.filter((message) => message.hasExcelAttachments).map((message) => message.uid));
        const orderAttachmentCount = sortedMessages.reduce((sum, message) => sum + message.attachmentCount, 0);
        const mailboxWasLoaded = hasLoadedMailbox.current;
        const newPendingMessages = findNewPendingOrderMessages(sortedMessages, seenMessageUids.current, extractedMessageUids);
        const shouldAlertNewMessages = mailboxWasLoaded && newPendingMessages.length > 0;
        const baseMailStatus = `近一周已扫描 ${result.scannedMessages} 封，筛出 ${sortedMessages.length} 封订单邮件，${orderAttachmentCount} 个订单附件`;

        seenMessageUids.current = mergeSeenMessageUids(seenMessageUids.current, sortedMessages);
        hasLoadedMailbox.current = true;

        setEmailMessages(sortedMessages);
        setSelectedMessageUids((current) => new Set([...current].filter((uid) => validUids.has(uid))));
        setNewMessageUids((current) => {
          const next = new Set([...current].filter((uid) => validUids.has(uid) && !extractedMessageUids.has(uid)));
          if (shouldAlertNewMessages) {
            newPendingMessages.forEach((message) => next.add(message.uid));
          }
          return next;
        });
        setMailStatus(shouldAlertNewMessages ? `发现 ${newPendingMessages.length} 封新订单邮件，${baseMailStatus}` : baseMailStatus);
        setLastRefreshLabel(`最后刷新 ${formatClock(new Date())}`);
        if (shouldAlertNewMessages) {
          const notification = buildNewOrderEmailNotification(newPendingMessages);
          appendLog(`发现新订单邮件：${newPendingMessages.map((message) => message.subject || "(无主题)").join(" / ")}`);
          void api
            .notifyNewOrderEmails(notification)
            .then((shown) => {
              if (!shown) {
                appendLog("系统通知不可用，已在邮件列表中标记新邮件");
              }
            })
            .catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              appendLog(`系统通知失败：${message}`);
            });
        }
        if (mode === "manual") {
          appendLog(`邮件列表已刷新：${sortedMessages.length} 封，待提取 ${pendingCountFrom(sortedMessages, extractedMessageUids)} 封`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setMailStatus(`邮件刷新失败：${message}`);
        if (mode === "manual") {
          appendLog(`邮件刷新失败：${message}`);
        }
      } finally {
        mailRefreshInFlight.current = false;
        setMailLoading(false);
      }
    },
    [appendLog, authCode, email, extractedMessageUids],
  );

  useEffect(() => {
    const removeProgressListener = api.onProgress((event) => renderProgress(event, appendLog, setProgress));
    void api.loadSettings().then((settings) => {
      setEmail(settings.email);
      setAuthCode(settings.authCode);
      setSettingsHidden(Boolean(settings.email && settings.authCode));
    });
    return removeProgressListener;
  }, [appendLog]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logLines]);

  useEffect(() => {
    if (!canUseEmail) {
      return;
    }

    void refreshEmails("auto");
    const timer = window.setInterval(() => {
      void refreshEmails("auto");
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [canUseEmail, refreshEmails]);

  async function runUiTask(message: string, task: () => Promise<void>): Promise<void> {
    if (bridgeMissing) {
      appendLog(`失败：${BRIDGE_MISSING_MESSAGE}`);
      setSummary(BRIDGE_MISSING_MESSAGE);
      setStatus("处理失败");
      return;
    }

    setBusy(true);
    setStatus(message);
    try {
      await task();
      setStatus("处理完成");
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      appendLog(`失败：${messageText}`);
      setSummary(messageText);
      setStatus("处理失败");
    } finally {
      setBusy(false);
    }
  }

  function resetResult(): void {
    setLatestOutputs(null);
    setProgress(0);
    setSummary("正在处理");
    setLogLines([]);
  }

  function renderExtractionResult(result: ExtractionResult): void {
    setLatestOutputs(result.outputs);
    setProgress(100);
    setSummary(`成功 ${result.rows.length} 个订单，失败 ${result.failures.length} 个，跳过 ${result.skippedFiles.length} 个文件`);
    appendLog(`输出目录：${result.outputs.outputDir}`);
    result.failures.forEach((failure) => appendLog(`失败 ${failure.path}: ${failure.error}`));
  }

  function renderEmailResult(result: EmailExtractionResult): void {
    appendLog(`已扫描 ${result.emailFetch.scannedMessages} 封邮件，下载 ${result.emailFetch.attachmentCount} 个订单附件`);
    renderExtractionResult(result.extraction);
  }

  async function saveSettings(): Promise<void> {
    await runUiTask("正在保存邮箱设置", async () => {
      const saved = await api.saveSettings({ email, authCode });
      setEmail(saved.email);
      setAuthCode(saved.authCode);
      setSettingsHidden(Boolean(saved.email && saved.authCode));
      appendLog("邮箱设置已保存");
      await refreshEmails("manual", saved);
    });
  }

  async function extractSelectedEmails(): Promise<void> {
    if (selectedExtractableUids.length === 0) {
      setSummary("请先勾选要提取的邮件。");
      return;
    }
    await extractEmailMessages(selectedExtractableUids, "正在提取选中邮件");
  }

  async function extractTodayEmails(): Promise<void> {
    const todayUids = emailMessages
      .filter((message) => message.hasExcelAttachments && isTodayMessage(message) && !extractedMessageUids.has(message.uid))
      .map((message) => message.uid);

    if (todayUids.length === 0) {
      setSummary("今日没有未提取的订单邮件。");
      return;
    }
    await extractEmailMessages(todayUids, "正在提取今日邮件");
  }

  async function extractEmailMessages(messageUids: string[], taskLabel: string): Promise<void> {
    await runUiTask(taskLabel, async () => {
      resetResult();
      appendLog(`已选择 ${messageUids.length} 封邮件`);
      const result = await api.extractEmail({
        email,
        authCode,
        server: DEFAULT_IMAP_SERVER,
        port: DEFAULT_IMAP_PORT,
        hours: EMAIL_LIST_DAYS * 24,
        messageUids,
        inferManual,
      });
      renderEmailResult(result);
      setExtractedMessageUids((current) => new Set([...current, ...messageUids]));
      setSelectedMessageUids((current) => {
        const next = new Set(current);
        messageUids.forEach((uid) => next.delete(uid));
        return next;
      });
      setNewMessageUids((current) => {
        const next = new Set(current);
        messageUids.forEach((uid) => next.delete(uid));
        return next;
      });
    });
  }

  async function extractLocal(paths: string[], scanRecursive: boolean): Promise<void> {
    await runUiTask("正在提取本地订单", async () => {
      resetResult();
      appendLog(`已选择 ${paths.length} 个输入`);
      const result = await api.extractLocal({
        paths,
        recursive: scanRecursive,
        inferManual,
      });
      renderExtractionResult(result);
    });
  }

  async function selectFiles(): Promise<void> {
    const paths = await api.selectFiles();
    if (paths.length > 0) {
      await extractLocal(paths, false);
    }
  }

  async function selectFolder(): Promise<void> {
    const paths = await api.selectFolder();
    if (paths.length > 0) {
      await extractLocal(paths, recursive);
    }
  }

  async function checkUpdates(): Promise<void> {
    await runUiTask("正在检查更新", async () => {
      const result = await api.checkUpdates();
      if (result.updateAvailable && result.downloadUrl) {
        setSummary(`发现新版本 ${result.latestVersion ?? ""}：${result.assetName ?? "安装包"}`);
        appendLog(`下载地址：${result.downloadUrl}`);
        return;
      }
      if (result.reason === "error") {
        setSummary(`检查更新失败：${result.error ?? "未知错误"}`);
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
        emailMessages
          .filter((message) => message.hasExcelAttachments && !extractedMessageUids.has(message.uid))
          .map((message) => message.uid),
      ),
    );
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
              <h1>订单快读</h1>
              <div className="connection-row">
                <Badge className="connection-badge" appearance="tint" color={email && authCode ? "success" : "subtle"}>
                  {email && authCode ? "已连接" : "未连接"}
                </Badge>
                <span className="connected-email">{email || "未设置邮箱"}</span>
              </div>
            </div>
            <div className="mail-command-actions">
              <Button appearance="primary" disabled={busy || mailLoading || !canUseEmail} onClick={() => void refreshEmails("manual")}>
                刷新邮件
              </Button>
              <Button disabled={busy || mailLoading || !canUseEmail} onClick={extractTodayEmails}>
                提取今日
              </Button>
              <Button disabled={busy || bridgeMissing} onClick={checkUpdates}>
                检查更新
              </Button>
              <Button disabled={busy || bridgeMissing} onClick={() => setSettingsHidden(false)}>
                修改邮箱设置
              </Button>
            </div>
          </div>
        </Card>

        <div className="workspace">
          <Card className="surface mail-list-panel">
            <div className="section-heading compact-heading">
              <div>
                <div className="section-title">近一周邮件</div>
                <div className="section-subtitle">按发生时间排序，每 5 分钟自动刷新。</div>
              </div>
              <Badge appearance="tint" color={pendingCount > 0 ? "warning" : "success"}>
                待提取 {pendingCount}
              </Badge>
            </div>
            <div className="mail-toolbar">
              <span className="mail-status">{mailLoading ? "正在刷新..." : mailStatus}</span>
              <div className="mail-toolbar-actions">
                <Button size="small" disabled={busy || mailLoading || emailMessages.length === 0} onClick={selectPendingMessages}>
                  全选待提取
                </Button>
                <Button size="small" disabled={busy || selectedMessageUids.size === 0} onClick={() => setSelectedMessageUids(new Set())}>
                  清空
                </Button>
              </div>
            </div>
            <div className="mail-refresh-note">{lastRefreshLabel || "保存邮箱后会自动加载邮件"}</div>
            <div className="mail-list" aria-label="近一周邮件列表">
              {emailMessages.length === 0 ? (
                <div className="empty-mail-list">{canUseEmail ? "暂无近一周订单邮件，点击刷新邮件重试。" : "填写邮箱和授权码后显示邮件。"}</div>
              ) : (
                emailMessages.map((message) => {
                  const extracted = extractedMessageUids.has(message.uid);
                  const pending = message.hasExcelAttachments && !extracted;
                  const newlyArrived = pending && newMessageUids.has(message.uid);
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
                          {message.hasExcelAttachments ? message.excelAttachmentNames.join(" / ") : "无订单附件"}
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
                    <div className="section-subtitle">只需要填写邮箱和授权码，保存后自动收起。</div>
                  </div>
                </div>
                <div className="settings-grid">
                  <Field label="邮箱">
                    <Input autoComplete="username" placeholder="name@company.com" value={email} onChange={(_, data) => setEmail(data.value)} />
                  </Field>
                  <Field label="授权码">
                    <Input
                      autoComplete="current-password"
                      placeholder="邮箱客户端授权码"
                      type="password"
                      value={authCode}
                      onChange={(_, data) => setAuthCode(data.value)}
                    />
                  </Field>
                </div>
                <div className="row-actions">
                  <Button appearance="primary" disabled={busy || bridgeMissing} onClick={saveSettings}>
                    保存设置
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
                  提取选中邮件
                </Button>
                <Button className="wide-button" disabled={busy || bridgeMissing} onClick={selectFiles}>
                  选择 Excel 并提取
                </Button>
                <Button className="wide-button" disabled={busy || bridgeMissing} onClick={selectFolder}>
                  选择文件夹并提取
                </Button>
              </div>
              <Divider />
              <div className="options-grid">
                <Checkbox checked={inferManual} label="自动标记需人工复核" onChange={(_, data) => setInferManual(Boolean(data.checked))} />
                <Checkbox checked={recursive} label="文件夹包含子目录" onChange={(_, data) => setRecursive(Boolean(data.checked))} />
              </div>
            </Card>

            <Card className="surface result-panel">
              <div className="result-header">
                <div>
                  <div className="section-title">处理结果</div>
                  <div id="summaryText" className="summary">
                    {summary}
                  </div>
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
  const label = event.status === "running" ? "正在处理" : event.status === "completed" ? "完成" : "失败";
  appendLog(`[${event.index}/${event.total}] ${label} ${event.filename}`);
}

function renderMessageBadge(message: EmailMessageSummary, extracted: boolean, newlyArrived = false) {
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

function sortMessages(messages: EmailMessageSummary[]): EmailMessageSummary[] {
  return [...messages].sort((left, right) => timestampOf(right.date) - timestampOf(left.date));
}

function timestampOf(date: string | undefined): number {
  if (!date) {
    return 0;
  }
  const timestamp = Date.parse(date);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function pendingCountFrom(messages: EmailMessageSummary[], extractedUids: Set<string>): number {
  return messages.filter((message) => message.hasExcelAttachments && !extractedUids.has(message.uid)).length;
}

function isTodayMessage(message: EmailMessageSummary): boolean {
  if (!message.date) {
    return false;
  }
  const messageDate = new Date(message.date);
  if (Number.isNaN(messageDate.getTime())) {
    return false;
  }
  const now = new Date();
  return (
    messageDate.getFullYear() === now.getFullYear() &&
    messageDate.getMonth() === now.getMonth() &&
    messageDate.getDate() === now.getDate()
  );
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

function formatClock(date: Date): string {
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
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

  return {
    loadSettings: async () => ({ email: "", authCode: "" }),
    saveSettings: async (settings) => ({ email: settings.email.trim(), authCode: settings.authCode }),
    selectFiles: async () => ["/preview/orders/order.xlsx"],
    selectFolder: async () => ["/preview/orders"],
    listEmails: async () => ({
      days: EMAIL_LIST_DAYS,
      scannedMessages: 3,
      messages: [
        {
          uid: "preview-3",
          subject: "今日订单附件",
          from: "Orders <orders@example.com>",
          date: new Date().toISOString(),
          attachmentCount: 1,
          excelAttachmentNames: ["today-order.xlsx"],
          hasExcelAttachments: true,
        },
        {
          uid: "preview-2",
          subject: "昨日订单更新",
          from: "Factory <factory@example.com>",
          date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          attachmentCount: 1,
          excelAttachmentNames: ["change.xlsm"],
          hasExcelAttachments: true,
        },
        {
          uid: "preview-1",
          subject: "普通通知",
          from: "Notice <notice@example.com>",
          date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
          attachmentCount: 0,
          excelAttachmentNames: [],
          hasExcelAttachments: false,
        },
      ],
    }),
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
    notifyNewOrderEmails: async () => false,
    checkUpdates: async () => ({
      updateAvailable: false,
      currentVersion: "preview",
      reason: "current",
    }),
    openPath: async () => undefined,
    onProgress: () => () => undefined,
  };
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found.");
}

createRoot(rootElement).render(<App />);
