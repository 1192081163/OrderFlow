# 订单整理助手

可视化桌面工具，用来拖入订单 Excel 文件或文件夹，自动生成订单整理结果。

## GitHub Release 下载

GitHub Release 会直接提供：

```text
order-organizer-assistant-windows.exe
order-organizer-assistant-macos.dmg
```

同一个版本重新运行 Release workflow 时，会覆盖 Release 里的同名文件。

桌面软件启动后会联网检查 GitHub Release。发现新版或同版本被覆盖成新构建时，会提示下载当前系统对应的安装包；检查失败不会影响订单提取。

### 发布新版本

推送版本标签后会自动测试、打包并上传 Release：

```bash
git tag v1.0.0
git push origin v1.0.0
```

也可以在 GitHub Actions 的 `Build Release` 工作流里手动运行，输入同一个 tag 会覆盖该版本的 `.exe` 和 `.dmg`。

## Windows 本地打包

1. 安装 Python 3.12，并勾选 `Add Python to PATH`。
2. 打开 CMD 或 PowerShell。
3. 进入项目目录。
4. 运行：

```bat
build_windows.bat
```

打包结果在：

```text
order-organizer-assistant-windows.exe
dist\订单整理助手.exe
```

发给别人时，可以直接发送 `order-organizer-assistant-windows.exe`。

## macOS 本地打包

```bash
./build_mac.sh
```

打包结果：

```text
dist/订单整理助手.app
order-organizer-assistant-macos.dmg
```

## 本地运行

```bash
python3 -m pip install -r requirements-desktop.txt
python3 desktop_app.py
```

## 文件说明

- `desktop_app.py`: 桌面界面。
- `desktop_runner.py`: 文件解析、输出路径和提取执行层。
- `extract.py`: 订单提取核心逻辑。
- `rules/`: 客户别名、工作日和忽略规则。
- `tests/`: 仓库内可运行的回归测试。
- `data/`: 本地订单源文件和 Job Track 对照表，默认不提交。
- `reports/`: 本地对比报告和临时提取结果，默认不提交。
- `build_windows.bat`: Windows 单文件 `.exe` 打包脚本。
- `build_mac.sh`: macOS `.dmg` 打包脚本。
- `.github/workflows/release.yml`: GitHub Release 自动构建和覆盖上传配置。

## 本地文件夹归类

```text
data/
  input/order_excels_dedup/      本地订单 Excel 样本
  reference/                     Job Track、人工整理结果等对照表
reports/
  jobtrack_0610_compare/         最近一次 Job Track 对比报告
```

`build/`、`dist/`、`*.zip`、`*.dmg`、`*.exe`、`__pycache__/`、`.pytest_cache/` 都是可重新生成的产物，清理项目时可以删除。

## 数据安全

仓库默认不包含订单 Excel、输出结果、打包产物和本地日志。把新订单拖进软件处理即可，不需要把订单文件提交到 GitHub。
