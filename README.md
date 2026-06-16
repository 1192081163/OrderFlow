# 订单整理助手

可视化桌面工具，用来从企业微信邮箱或本地订单 Excel 提取订单信息，自动生成订单整理结果。

## Electron / TypeScript 本地运行

当前重构版本使用 Electron、React、TypeScript、Vite、Fluent UI React、Vitest 和 ExcelJS 做桌面壳、界面、邮箱附件读取和输出流程；订单提取规则继续使用仓库里的 Python 规则引擎，避免重新迁移复杂规则。

首次安装依赖：

```bash
npm install
python3 -m pip install -r requirements-python-runner.txt
```

本地启动桌面窗口：

```bash
npm start
```

开发期常用校验：

```bash
npm run typecheck
npm test
npm run build
```

`npm start` 会先构建 TypeScript 主进程和 Vite renderer，再打开 Electron 窗口。

本地开发默认调用系统 `python3`；Windows 本地开发默认调用 `py -3`。如果需要指定 Python，可设置 `ORDER_ORGANIZER_PYTHON`。

## GitHub Release 下载

GitHub Release 会直接提供：

```text
order-organizer-assistant-windows.exe
```

同一个版本重新运行 Release workflow 时，会覆盖 Release 里的同名文件。

Release 构建现在走 Electron / TypeScript 链路，并只打包 Windows 安装程序。CI 会用 PyInstaller 生成一个很小的 Python 规则运行器，随 Electron 应用一起内置；不再打包旧的 Python 桌面程序，也不做 macOS 包。

### 发布新版本

推送版本标签后会自动测试、打包并上传 Release：

```bash
git tag v1.0.0
git push origin v1.0.0
```

也可以在 GitHub Actions 的 `Build Release` 工作流里手动运行，输入同一个 tag 会覆盖该版本的 `.exe`。

## Windows 本地打包

在 Windows 上运行：

```bash
npm install
py -3 -m pip install -r requirements-python-runner.txt
./scripts/build-python-runner-win.ps1
npm run dist:win
```

打包结果在：

```text
release/order-organizer-assistant-windows.exe
```

发给别人时，可以直接发送 `order-organizer-assistant-windows.exe`。

## Python 规则和历史界面

```bash
python3 -m pip install -r requirements-desktop.txt
python3 desktop_app.py
```

`extract.py`、`desktop_runner.py` 和 `rules/` 是当前订单提取规则来源。`desktop_app.py` 是旧的 Python 桌面界面，用于对照旧实现；新桌面应用入口优先使用 `npm start`。

## 从企业微信邮箱提取

1. 打开软件后填写企业微信邮箱和邮箱授权码。
2. 保存后邮箱设置会自动收起。
3. 点击 `从邮箱提取订单`，软件会读取收件箱里的 `.xlsx/.xlsm` 附件并生成订单整理结果。

原来的拖入文件夹、选择 Excel 文件方式仍然可用。

## 文件说明

- `src/main/`: Electron 主进程和 IPC。
- `src/preload/`: 安全 preload 桥接。
- `src/renderer/`: React + Fluent UI React 的 Electron 界面。
- `src/core/`: TypeScript 文件扫描、邮箱附件、Python 规则调用和输出流程。
- `src/shared/`: 前后端共享类型。
- `python_extraction_bridge.py`: Electron 调用 Python 规则引擎的 JSON 桥接入口。
- `requirements-python-runner.txt`: 本地开发和 CI 构建 Python 规则运行器需要的依赖。
- `python-helper/`: CI 或本地 Windows 打包时生成的 Python 规则运行器目录。
- `desktop_app.py`: Python 历史桌面界面。
- `desktop_runner.py`: Python 文件解析、输出路径和提取执行层。
- `email_source.py`: Python 历史企业微信 IMAP 连接、邮件附件筛选和附件落盘。
- `extract.py`: Python 订单提取核心逻辑。
- `rules/`: 客户别名、工作日和忽略规则。
- `tests/`: 仓库内可运行的回归测试。
- `data/`: 本地订单源文件和 Job Track 对照表，默认不提交。
- `reports/`: 本地对比报告和临时提取结果，默认不提交。
- `package.json`: Electron 本地运行、测试、构建和打包脚本。
- `.github/workflows/release.yml`: Electron GitHub Release 自动构建和覆盖上传配置。

## 本地文件夹归类

```text
data/
  input/order_excels_dedup/      本地订单 Excel 样本
  reference/                     Job Track、人工整理结果等对照表
reports/
  jobtrack_0610_compare/         最近一次 Job Track 对比报告
```

`build/`、`dist/`、`release/`、`*.zip`、`*.exe`、`__pycache__/`、`.pytest_cache/` 都是可重新生成的产物，清理项目时可以删除。

## 数据安全

仓库默认不包含订单 Excel、输出结果、打包产物和本地日志。把新订单拖进软件处理即可，不需要把订单文件提交到 GitHub。
