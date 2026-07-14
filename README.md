# 订单整理助手

可视化桌面工具，用来从企业微信邮箱或本地订单 Excel 提取订单信息，并自动生成订单整理结果。

## 下载桌面版

普通用户不需要安装 Node.js、Python 或开发依赖。国内 Windows 用户打开 [Gitee Latest Release](https://gitee.com/wei-dongyu_1_0/OrderFlow/releases/latest)，下载：

```text
orderflow-desktop-windows.exe
```

GitHub 作为源仓库和备用下载入口；Mac 用户打开 [GitHub Latest Release](https://github.com/1192081163/OrderFlow/releases/latest)，下载：

```text
orderflow-desktop-mac.dmg
```

Windows 下载后双击 exe 就会直接打开软件，不会出现安装向导。Mac 下载 DMG 后拖入 Applications 打开；当前 Mac 包未做 Apple 公证，首次打开如果被系统拦截，可右键选择打开。运行环境已经内置在软件中，首次打开后填写企业微信邮箱和邮箱授权码，或直接拖入本地 Excel 文件提取订单。

### 本地邮箱登录

打开软件后只需填写企业微信邮箱地址和客户端授权码。授权码使用 Windows DPAPI 加密保存在本机，不会上传到任何远程邮件服务。

Windows 登录后软件会自动在系统托盘运行并监听新订单邮件。关闭窗口后软件继续在系统托盘监听；只有从托盘选择“退出”才会停止。邮件列表固定保存最近 7 天，收到订单邮件后仍需手动勾选并点击提取。

## 使用方式

1. 打开软件后填写企业微信邮箱地址和客户端授权码。
2. 保存并登录后，软件在本机同步最近 7 天的订单邮件。
3. 勾选要提取的邮件，点击 `提取选中邮件`。
4. 也可以点击 `本地提取`，选择或拖入 Excel 文件。
5. 软件会读取 `.xlsx/.xlsm` 附件或本地文件，并生成订单整理结果。

## 本地开发运行

当前版本使用 Electron、React、TypeScript、Vite、Fluent UI React 和 Vitest 构建桌面应用。订单提取规则继续使用仓库里的 Python 规则引擎，Electron 通过 `python_extraction_bridge.py` 调用它。

首次安装开发依赖：

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

## Windows 打包

在 Windows 上运行：

```powershell
npm install
py -3 -m pip install -r requirements-python-runner.txt
./scripts/build-python-runner-win.ps1
npm run dist:win
```

打包结果是可直接双击打开的便携版 exe：

```text
release/orderflow-desktop-windows.exe
```

## macOS 打包

在 macOS 上运行：

```bash
npm install
python3 -m pip install -r requirements-python-runner.txt
bash ./scripts/build-python-runner-mac.sh
npm run dist:mac
```

打包结果是 DMG：

```text
release/orderflow-desktop-mac.dmg
```

## Release 与国内镜像

推送到 `main` 后，GitHub Actions 会自动测试、打包并创建新的 GitHub Latest Release，同时把源码、标签和 Windows 便携版同步到 Gitee。应用检查更新时优先访问 Gitee，Gitee 不可用时再回退 GitHub：

```text
orderflow-desktop-windows.exe
orderflow-desktop-mac.dmg
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
data/              本地订单 Excel 样本，默认不提交
reports/           本地对比报告和临时提取结果，默认不提交
build/ dist/       可重新生成的构建产物
release/           本地打包产物，默认不提交
__pycache__/       可删除的 Python 缓存
.pytest_cache/     可删除的 Python 缓存
```

## 数据安全

仓库默认不包含订单 Excel、输出结果、打包产物和本地日志。把新订单拖进软件处理即可，不需要把订单文件提交到 GitHub。

不要提交真实订单、客户资料、邮箱内容、邮箱授权码、导出的报表或本地打包产物。`.gitignore` 已排除 `data/`、`outputs/`、`reports/`、`build/`、`dist/`、`release/` 和常见 Excel 文件；公开发布时请只从 Git 跟踪文件发布，不要上传整个本地工作目录。

邮箱授权码使用 Windows DPAPI 加密保存在本机：

```text
~/.order_organizer_assistant/email_settings.json
```

配置文件只保存邮箱地址、DPAPI 密文和本地启动设置，不保存明文授权码。邮件元数据保存在本机 SQLite 中并固定保留最近 7 天；应用不开放入站端口，也不会上传邮箱数据。

## 开源与许可证

本项目使用 MIT 许可证，详见 `LICENSE`。

贡献代码前请运行：

```bash
npm run typecheck
npm test
python -m pytest tests
npm run build
```

更多安全和贡献说明见 `SECURITY.md` 和 `CONTRIBUTING.md`。
