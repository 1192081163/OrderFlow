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
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import type { OrderOrganizerApi } from "../preload/preload.js";
import type { ExtractionResult, OutputPaths, ProgressEvent } from "../shared/types.js";
import type { EmailExtractionResult } from "../core/extractionService.js";

const api: OrderOrganizerApi = window.orderOrganizer ?? createPreviewApi();

function App() {
  const [email, setEmail] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [server, setServer] = useState("imap.exmail.qq.com");
  const [port, setPort] = useState("993");
  const [hours, setHours] = useState("168");
  const [recursive, setRecursive] = useState(false);
  const [inferManual, setInferManual] = useState(true);
  const [settingsHidden, setSettingsHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("本地处理企业微信邮箱附件和订单 Excel");
  const [summary, setSummary] = useState("尚未开始");
  const [progress, setProgress] = useState(0);
  const [latestOutputs, setLatestOutputs] = useState<OutputPaths | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const logRef = useRef<HTMLPreElement>(null);

  const appendLog = useCallback((line: string) => {
    const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    setLogLines((current) => [...current, `${time} ${line}`]);
  }, []);

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

  async function runUiTask(message: string, task: () => Promise<void>): Promise<void> {
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
    appendLog(`已扫描 ${result.emailFetch.scannedMessages} 封邮件，下载 ${result.emailFetch.attachmentCount} 个 Excel 附件`);
    renderExtractionResult(result.extraction);
  }

  async function saveSettings(): Promise<void> {
    await runUiTask("正在保存邮箱设置", async () => {
      const saved = await api.saveSettings({ email, authCode });
      setEmail(saved.email);
      setAuthCode(saved.authCode);
      setSettingsHidden(Boolean(saved.email && saved.authCode));
      appendLog("邮箱设置已保存");
    });
  }

  async function extractEmail(): Promise<void> {
    await runUiTask("正在从邮箱提取订单", async () => {
      resetResult();
      const result = await api.extractEmail({
        email,
        authCode,
        server,
        port: Number(port),
        hours: Number(hours),
        inferManual,
      });
      renderEmailResult(result);
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

  function openLatest(key: keyof OutputPaths): void {
    if (latestOutputs?.[key]) {
      void api.openPath(latestOutputs[key]);
    }
  }

  return (
    <FluentProvider theme={webLightTheme}>
      <main className="app">
        <header className="app-header">
          <div className="title-group">
            <Badge appearance="filled" color="brand">
              订单整理
            </Badge>
            <h1>订单提取助手</h1>
            <p id="statusText">{status}</p>
          </div>
          <Button appearance="subtle" disabled={busy} onClick={() => setSettingsHidden((value) => !value)}>
            邮箱设置
          </Button>
        </header>

        <div className="workspace">
          <div className="control-column">
            {!settingsHidden && (
              <Card id="settingsPanel" className="surface settings-card">
                <div className="section-heading">
                  <div>
                    <div className="section-title">企业微信邮箱</div>
                    <div className="section-subtitle">保存后会自动收起，可随时修改。</div>
                  </div>
                </div>
                <div className="settings-grid">
                  <Field label="邮箱">
                    <Input
                      autoComplete="username"
                      placeholder="name@company.com"
                      value={email}
                      onChange={(_, data) => setEmail(data.value)}
                    />
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
                  <Field label="IMAP 服务器">
                    <Input value={server} onChange={(_, data) => setServer(data.value)} />
                  </Field>
                  <Field label="端口">
                    <Input type="number" min={1} max={65535} value={port} onChange={(_, data) => setPort(data.value)} />
                  </Field>
                </div>
                <div className="row-actions">
                  <Button appearance="primary" disabled={busy} onClick={saveSettings}>
                    保存设置
                  </Button>
                </div>
              </Card>
            )}

            <Card className="surface action-card">
              <div className="section-heading">
                <div>
                  <div className="section-title">提取来源</div>
                  <div className="section-subtitle">优先从邮箱读取附件，也可直接选择本地 Excel。</div>
                </div>
              </div>
              <div className="primary-actions">
                <Button appearance="primary" className="large-action wide-button" disabled={busy} onClick={extractEmail}>
                  从邮箱提取订单
                </Button>
                <Button className="wide-button" disabled={busy} onClick={selectFiles}>
                  选择 Excel 并提取
                </Button>
                <Button className="wide-button" disabled={busy} onClick={selectFolder}>
                  选择文件夹并提取
                </Button>
              </div>
              <Divider />
              <div className="options-grid">
                <Checkbox
                  checked={inferManual}
                  label="自动标记需人工复核"
                  onChange={(_, data) => setInferManual(Boolean(data.checked))}
                />
                <Checkbox
                  checked={recursive}
                  label="文件夹包含子目录"
                  onChange={(_, data) => setRecursive(Boolean(data.checked))}
                />
                <label className="hours-control">
                  <span>扫描最近邮件</span>
                  <Input
                    aria-label="扫描最近邮件小时数"
                    className="hours-input"
                    type="number"
                    min={1}
                    max={720}
                    value={hours}
                    onChange={(_, data) => setHours(data.value)}
                  />
                  <span>小时</span>
                </label>
              </div>
            </Card>
          </div>

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
                  <Button onClick={() => openLatest("outputDir")}>打开输出目录</Button>
                  <Button onClick={() => openLatest("xlsxOutput")}>打开 Excel</Button>
                  <Button onClick={() => openLatest("csvOutput")}>打开 CSV</Button>
                  <Button onClick={() => openLatest("auditOutput")}>打开复核表</Button>
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
    extractLocal: async () => extraction,
    extractEmail: async () => ({
      emailFetch: {
        files: ["/preview/orders/order.xlsx"],
        scannedMessages: 0,
        attachmentCount: 0,
        downloadDir: "/preview/orders",
      },
      extraction,
    }),
    openPath: async () => undefined,
    onProgress: () => () => undefined,
  };
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing React root element");
}

createRoot(rootElement).render(<App />);
