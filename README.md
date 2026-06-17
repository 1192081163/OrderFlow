# 订单整理助手

可视化桌面工具，用来从企业微信邮箱或本地订单 Excel 提取订单信息，并自动生成订单整理结果。

## 本地运行

当前版本使用 Electron、React、TypeScript、Vite、Fluent UI React 和 Vitest 构建桌面应用。订单提取规则继续使用仓库里的 Python 规则引擎，Electron 通过 `python_extraction_bridge.py` 调用它。

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

本地开发默认调用系统 `python3`；Windows 本地开发默认调用 `py -3`。如需指定 Python，可设置 `ORDER_ORGANIZER_PYTHON`。

## 从企业微信邮箱提取

1. 打开软件后填写企业微信邮箱和邮箱授权码。
2. 保存后邮箱设置会自动收起。
3. 点击 `从邮箱提取订单` 或 `扫描全部邮件`。
4. 软件会读取收件箱里的 `.xlsx/.xlsm` 附件并生成订单整理结果。

选择本地 Excel 文件或文件夹的方式仍然可用。

## Windows 打包

在 Windows 上运行：

```bash
npm install
py -3 -m pip install -r requirements-python-runner.txt
./scripts/build-python-runner-win.ps1
npm run dist:win
```

打包结果：

```text
release/order-organizer-assistant-windows.exe
```

## GitHub Release

推送到 `main` 后，GitHub Actions 会自动测试、打包，并创建新的 Latest Release。Release 提供：

```text
order-organizer-assistant-windows.exe
```

## 文件说明

- `src/main/`: Electron 主进程和 IPC。
- `src/preload/`: 安全 preload 桥接。
- `src/renderer/`: React + Fluent UI React 界面。
- `src/core/`: TypeScript 文件扫描、邮箱附件、Python 调用和更新检查。
- `src/shared/`: 前后端共享类型。
- `python_extraction_bridge.py`: Electron 调用 Python 规则引擎的 JSON 桥接入口。
- `desktop_runner.py`: Python 文件解析、输出路径和提取执行层。
- `extract.py`: Python 订单提取核心逻辑。
- `rules/`: 客户别名、工作日和忽略规则。
- `requirements-python-runner.txt`: 本地开发和 CI 构建 Python 规则运行器需要的依赖。
- `scripts/build-python-runner-win.ps1`: Windows 打包前生成内置 Python 规则运行器。
- `tests/`: Python 规则层回归测试。

## 本地文件夹

```text
data/                         本地订单 Excel 样本，默认不提交
reports/                      本地对比报告和临时提取结果，默认不提交
build/ dist/ release/         可重新生成的构建产物
__pycache__/ .pytest_cache/   可删除的 Python 缓存
```

## 数据安全

仓库默认不包含订单 Excel、输出结果、打包产物和本地日志。把新订单拖进软件处理即可，不需要把订单文件提交到 GitHub。
