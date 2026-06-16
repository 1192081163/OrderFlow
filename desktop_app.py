from __future__ import annotations

import sys
from pathlib import Path

from PySide6.QtCore import Qt, QThread, QTimer, QUrl, Signal, Slot
from PySide6.QtGui import QDesktopServices, QDragEnterEvent, QDropEvent, QIcon
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QFileDialog,
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QProgressBar,
    QSizePolicy,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from branding import APP_DISPLAY_NAME
from build_info import APP_BUILD_COMMIT, APP_RELEASE_TAG, APP_VERSION
from desktop_runner import ExtractionResult, NoInputFilesError, run_extraction
from updater import (
    UpdateCheckInput,
    UpdateCheckResult,
    UpdateDownloadResult,
    check_for_update,
    download_update_asset,
)


class DropZone(QFrame):
    pathsDropped = Signal(list)

    def __init__(self) -> None:
        super().__init__()
        self.setObjectName("dropZone")
        self.setAcceptDrops(True)
        self.setMinimumHeight(180)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 24, 24, 24)
        layout.setSpacing(8)

        title = QLabel("拖入订单文件夹或 Excel 文件")
        title.setObjectName("dropTitle")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)

        subtitle = QLabel("支持文件夹、多个 .xlsx/.xlsm 文件；拖入后自动开始提取")
        subtitle.setObjectName("dropSubtitle")
        subtitle.setAlignment(Qt.AlignmentFlag.AlignCenter)

        layout.addStretch(1)
        layout.addWidget(title)
        layout.addWidget(subtitle)
        layout.addStretch(1)

    def dragEnterEvent(self, event: QDragEnterEvent) -> None:
        if event.mimeData().hasUrls():
            event.acceptProposedAction()
            self.setProperty("dragActive", True)
            self.style().unpolish(self)
            self.style().polish(self)
        else:
            event.ignore()

    def dragLeaveEvent(self, event) -> None:  # type: ignore[no-untyped-def]
        self.setProperty("dragActive", False)
        self.style().unpolish(self)
        self.style().polish(self)
        super().dragLeaveEvent(event)

    def dropEvent(self, event: QDropEvent) -> None:
        paths = [url.toLocalFile() for url in event.mimeData().urls() if url.isLocalFile()]
        self.setProperty("dragActive", False)
        self.style().unpolish(self)
        self.style().polish(self)
        if paths:
            self.pathsDropped.emit(paths)
            event.acceptProposedAction()
        else:
            event.ignore()


def resource_path(relative_path: str) -> Path:
    base_path = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base_path / relative_path


class ExtractionWorker(QThread):
    progressChanged = Signal(int, int, str, str)
    logMessage = Signal(str)
    extractionFinished = Signal(object)
    extractionFailed = Signal(str)

    def __init__(self, paths: list[str], recursive: bool, infer_manual: bool) -> None:
        super().__init__()
        self.paths = paths
        self.recursive = recursive
        self.infer_manual = infer_manual

    def run(self) -> None:
        try:
            result = run_extraction(
                self.paths,
                recursive=self.recursive,
                infer_manual=self.infer_manual,
                progress=self._report_progress,
            )
        except NoInputFilesError as exc:
            self.extractionFailed.emit(str(exc))
        except Exception as exc:
            self.extractionFailed.emit(f"{type(exc).__name__}: {exc}")
        else:
            self.extractionFinished.emit(result)

    def _report_progress(self, index: int, total: int, path: Path, status: str) -> None:
        self.progressChanged.emit(index, total, path.name, status)
        if status == "running":
            self.logMessage.emit(f"[{index}/{total}] 正在处理 {path.name}")
        elif status == "completed":
            self.logMessage.emit(f"[{index}/{total}] 完成 {path.name}")
        elif status == "failed":
            self.logMessage.emit(f"[{index}/{total}] 失败 {path.name}")


class UpdateCheckWorker(QThread):
    updateCheckFinished = Signal(object, bool)

    def __init__(self, current: UpdateCheckInput, manual: bool) -> None:
        super().__init__()
        self.current = current
        self.manual = manual

    def run(self) -> None:
        result = check_for_update(self.current)
        self.updateCheckFinished.emit(result, self.manual)


class UpdateDownloadWorker(QThread):
    updateDownloadFinished = Signal(object)
    updateDownloadFailed = Signal(str)

    def __init__(self, update: UpdateCheckResult) -> None:
        super().__init__()
        self.update = update

    def run(self) -> None:
        try:
            result = download_update_asset(self.update.download_url, self.update.asset_name)
        except Exception as exc:
            self.updateDownloadFailed.emit(f"{type(exc).__name__}: {exc}")
        else:
            self.updateDownloadFinished.emit(result)


class OrderExtractionWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.worker: ExtractionWorker | None = None
        self.update_worker: UpdateCheckWorker | None = None
        self.update_download_worker: UpdateDownloadWorker | None = None
        self.last_result: ExtractionResult | None = None

        self.setWindowTitle(APP_DISPLAY_NAME)
        icon_path = resource_path("assets/app_icon.png")
        if icon_path.exists():
            self.setWindowIcon(QIcon(str(icon_path)))
        self.setMinimumSize(920, 680)

        root = QWidget()
        self.setCentralWidget(root)

        layout = QVBoxLayout(root)
        layout.setContentsMargins(22, 18, 22, 18)
        layout.setSpacing(14)

        header = QHBoxLayout()
        title_group = QVBoxLayout()
        title_group.setSpacing(3)
        title = QLabel(APP_DISPLAY_NAME)
        title.setObjectName("appTitle")
        self.status_label = QLabel("等待拖入订单文件夹或 Excel 文件")
        self.status_label.setObjectName("statusText")
        title_group.addWidget(title)
        title_group.addWidget(self.status_label)
        header.addLayout(title_group)
        header.addStretch(1)
        self.version_label = QLabel(f"版本 {APP_RELEASE_TAG}")
        self.version_label.setObjectName("versionText")
        self.check_update_button = QPushButton("检查更新")
        self.check_update_button.clicked.connect(self.check_for_updates_manual)
        header.addWidget(self.version_label)
        header.addWidget(self.check_update_button)
        layout.addLayout(header)

        self.drop_zone = DropZone()
        self.drop_zone.pathsDropped.connect(self.start_extraction)
        layout.addWidget(self.drop_zone)

        options_row = QHBoxLayout()
        self.recursive_checkbox = QCheckBox("递归扫描子文件夹")
        self.infer_manual_checkbox = QCheckBox("自动补全可推断字段")
        self.infer_manual_checkbox.setChecked(True)
        self.select_folder_button = QPushButton("选择文件夹")
        self.select_files_button = QPushButton("选择 Excel 文件")
        self.reset_button = QPushButton("清空")
        self.select_folder_button.clicked.connect(self.choose_folder)
        self.select_files_button.clicked.connect(self.choose_files)
        self.reset_button.clicked.connect(self.reset_view)
        options_row.addWidget(self.recursive_checkbox)
        options_row.addWidget(self.infer_manual_checkbox)
        options_row.addStretch(1)
        options_row.addWidget(self.select_folder_button)
        options_row.addWidget(self.select_files_button)
        options_row.addWidget(self.reset_button)
        layout.addLayout(options_row)

        progress_panel = QFrame()
        progress_panel.setObjectName("panel")
        progress_layout = QGridLayout(progress_panel)
        progress_layout.setContentsMargins(16, 14, 16, 14)
        progress_layout.setHorizontalSpacing(18)
        progress_layout.setVerticalSpacing(10)

        self.progress_bar = QProgressBar()
        self.progress_bar.setRange(0, 100)
        self.progress_bar.setValue(0)
        self.current_file_label = QLabel("当前文件：-")
        self.count_label = QLabel("文件：0 | 成功：0 | 失败：0 | 跳过：0")
        progress_layout.addWidget(self.progress_bar, 0, 0, 1, 3)
        progress_layout.addWidget(self.current_file_label, 1, 0, 1, 2)
        progress_layout.addWidget(self.count_label, 1, 2)
        layout.addWidget(progress_panel)

        self.log_view = QTextEdit()
        self.log_view.setObjectName("logView")
        self.log_view.setReadOnly(True)
        self.log_view.setPlaceholderText("运行日志会显示在这里")
        layout.addWidget(self.log_view, 1)

        actions = QHBoxLayout()
        self.open_workbook_button = QPushButton("打开订单整理结果")
        self.open_folder_button = QPushButton("打开输出文件夹")
        self.open_workbook_button.setEnabled(False)
        self.open_folder_button.setEnabled(False)
        self.open_workbook_button.clicked.connect(self.open_output_workbook)
        self.open_folder_button.clicked.connect(self.open_output_folder)
        actions.addStretch(1)
        actions.addWidget(self.open_workbook_button)
        actions.addWidget(self.open_folder_button)
        layout.addLayout(actions)

        self.apply_styles()
        QTimer.singleShot(1500, self.check_for_updates_auto)

    def apply_styles(self) -> None:
        self.setStyleSheet(
            """
            QWidget {
                background: #f5f7f8;
                color: #1f2933;
                font-size: 14px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
            }
            QLabel#appTitle {
                font-size: 24px;
                font-weight: 700;
            }
            QLabel#statusText, QLabel#dropSubtitle, QLabel#versionText {
                color: #617080;
            }
            QFrame#dropZone {
                background: #ffffff;
                border: 2px dashed #9fb0bf;
                border-radius: 8px;
            }
            QFrame#dropZone[dragActive="true"] {
                background: #edf7f3;
                border-color: #16815f;
            }
            QLabel#dropTitle {
                background: transparent;
                color: #17212b;
                font-size: 22px;
                font-weight: 700;
            }
            QLabel#dropSubtitle {
                background: transparent;
                font-size: 13px;
            }
            QFrame#panel, QTextEdit#logView {
                background: #ffffff;
                border: 1px solid #d7dee5;
                border-radius: 8px;
            }
            QTextEdit#logView {
                padding: 10px;
                font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                font-size: 12px;
            }
            QPushButton {
                background: #ffffff;
                border: 1px solid #c9d3dc;
                border-radius: 6px;
                padding: 8px 12px;
            }
            QPushButton:hover {
                background: #eef3f6;
            }
            QPushButton:disabled {
                color: #94a0ab;
                background: #edf1f4;
            }
            QCheckBox {
                spacing: 8px;
            }
            QProgressBar {
                background: #e8edf1;
                border: 1px solid #cad4dc;
                border-radius: 6px;
                height: 18px;
                text-align: center;
            }
            QProgressBar::chunk {
                background: #16815f;
                border-radius: 5px;
            }
            """
        )

    def current_update_input(self) -> UpdateCheckInput:
        return UpdateCheckInput(current_version=APP_VERSION, current_commit=APP_BUILD_COMMIT)

    @Slot()
    def check_for_updates_manual(self) -> None:
        self.start_update_check(manual=True)

    @Slot()
    def check_for_updates_auto(self) -> None:
        self.start_update_check(manual=False)

    def start_update_check(self, manual: bool) -> None:
        if self.update_worker and self.update_worker.isRunning():
            if manual:
                QMessageBox.information(self, "正在检查", "正在检查更新，请稍后。")
            return

        if manual:
            self.append_log("正在检查更新")
        self.check_update_button.setText("检查中...")
        self.check_update_button.setEnabled(False)
        self.update_worker = UpdateCheckWorker(self.current_update_input(), manual=manual)
        self.update_worker.updateCheckFinished.connect(self.on_update_check_finished)
        self.update_worker.finished.connect(self.on_update_check_worker_finished)
        self.update_worker.start()

    @Slot()
    def on_update_check_worker_finished(self) -> None:
        if self.update_download_worker is not None:
            return
        self.check_update_button.setText("检查更新")
        self.check_update_button.setEnabled(True)

    @Slot(object, bool)
    def on_update_check_finished(self, result: UpdateCheckResult, manual: bool) -> None:
        self.update_worker = None
        if result.update_available:
            self.prompt_for_update(result)
            return
        if result.error:
            if manual:
                QMessageBox.warning(self, "检查更新失败", result.error)
                self.append_log(result.error)
            return
        if manual:
            QMessageBox.information(self, "已是最新版本", f"当前版本 {APP_RELEASE_TAG} 已是最新。")
            self.append_log("当前已是最新版本")

    def prompt_for_update(self, result: UpdateCheckResult) -> None:
        message = (
            f"发现新版本 {result.latest_version}\n"
            f"当前版本：{APP_RELEASE_TAG}\n"
            f"下载文件：{result.asset_name}\n\n"
            "是否在软件内下载更新包？"
        )
        response = QMessageBox.question(
            self,
            "发现新版本",
            message,
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.Yes,
        )
        if response == QMessageBox.StandardButton.Yes:
            self.start_update_download(result)
        else:
            self.append_log("已取消更新下载")
        self.append_log(f"发现新版本 {result.latest_version}")

    def start_update_download(self, result: UpdateCheckResult) -> None:
        if self.update_download_worker and self.update_download_worker.isRunning():
            QMessageBox.information(self, "正在下载", "正在下载更新包，请稍后。")
            return

        self.status_label.setText("正在下载更新包")
        self.append_log(f"正在下载更新包 {result.asset_name}")
        self.check_update_button.setText("下载中...")
        self.check_update_button.setEnabled(False)
        self.update_download_worker = UpdateDownloadWorker(result)
        self.update_download_worker.updateDownloadFinished.connect(self.on_update_download_finished)
        self.update_download_worker.updateDownloadFailed.connect(self.on_update_download_failed)
        self.update_download_worker.finished.connect(self.on_update_download_worker_finished)
        self.update_download_worker.start()

    @Slot()
    def on_update_download_worker_finished(self) -> None:
        self.update_download_worker = None
        self.check_update_button.setText("检查更新")
        self.check_update_button.setEnabled(True)

    @Slot(object)
    def on_update_download_finished(self, result: UpdateDownloadResult) -> None:
        self.status_label.setText("更新包已下载")
        self.append_log(f"更新包已下载 {result.path}")
        QMessageBox.information(self, "下载完成", f"更新包已下载：\n{result.path}\n\n即将打开。")
        opened = QDesktopServices.openUrl(QUrl.fromLocalFile(str(result.path)))
        if not opened:
            QMessageBox.information(self, "请手动打开", f"请手动打开更新包：\n{result.path}")

    @Slot(str)
    def on_update_download_failed(self, message: str) -> None:
        self.status_label.setText("更新下载失败")
        self.append_log(f"更新下载失败: {message}")
        QMessageBox.warning(self, "更新下载失败", message)

    @Slot()
    def choose_folder(self) -> None:
        folder = QFileDialog.getExistingDirectory(self, "选择订单文件夹")
        if folder:
            self.start_extraction([folder])

    @Slot()
    def choose_files(self) -> None:
        files, _ = QFileDialog.getOpenFileNames(
            self,
            "选择订单 Excel 文件",
            "",
            "Excel 文件 (*.xlsx *.xlsm)",
        )
        if files:
            self.start_extraction(files)

    @Slot(list)
    def start_extraction(self, paths: list[str]) -> None:
        if self.worker and self.worker.isRunning():
            QMessageBox.information(self, "正在处理", "请等待当前提取完成。")
            return

        self.last_result = None
        self.open_workbook_button.setEnabled(False)
        self.open_folder_button.setEnabled(False)
        self.progress_bar.setValue(0)
        self.current_file_label.setText("当前文件：准备中")
        self.count_label.setText("文件：0 | 成功：0 | 失败：0 | 跳过：0")
        self.log_view.clear()
        self.append_log(f"收到 {len(paths)} 个输入项")
        self.set_busy(True)

        self.worker = ExtractionWorker(
            paths=paths,
            recursive=self.recursive_checkbox.isChecked(),
            infer_manual=self.infer_manual_checkbox.isChecked(),
        )
        self.worker.progressChanged.connect(self.on_progress_changed)
        self.worker.logMessage.connect(self.append_log)
        self.worker.extractionFinished.connect(self.on_extraction_finished)
        self.worker.extractionFailed.connect(self.on_extraction_failed)
        self.worker.finished.connect(lambda: self.set_busy(False))
        self.worker.start()

    @Slot(int, int, str, str)
    def on_progress_changed(self, index: int, total: int, filename: str, status: str) -> None:
        percent = int((index / total) * 100) if total else 0
        self.progress_bar.setValue(percent)
        status_text = {
            "running": "正在处理",
            "completed": "已完成",
            "failed": "处理失败",
        }.get(status, status)
        self.current_file_label.setText(f"当前文件：{filename} ({status_text})")

    @Slot(str)
    def append_log(self, message: str) -> None:
        self.log_view.append(message)

    @Slot(object)
    def on_extraction_finished(self, result: ExtractionResult) -> None:
        self.last_result = result
        self.progress_bar.setValue(100)
        self.current_file_label.setText("当前文件：完成")
        self.count_label.setText(
            f"文件：{len(result.input_files)} | 成功：{len(result.rows)} | "
            f"失败：{len(result.failures)} | 跳过：{len(result.skipped_files)}"
        )
        for skipped in result.skipped_files:
            self.append_log(f"跳过 {skipped}")
        for failure in result.failures:
            self.append_log(f"失败详情 {failure.path.name}: {failure.error}")
        self.append_log(f"已写出 {result.outputs.xlsx_output}")
        self.append_log(f"已写出 {result.outputs.csv_output}")
        self.append_log(f"已写出 {result.outputs.audit_output}")
        self.status_label.setText("提取完成")
        self.open_workbook_button.setEnabled(result.outputs.xlsx_output.exists())
        self.open_folder_button.setEnabled(result.outputs.output_dir.exists())

    @Slot(str)
    def on_extraction_failed(self, message: str) -> None:
        self.progress_bar.setValue(0)
        self.current_file_label.setText("当前文件：-")
        self.status_label.setText("提取失败")
        self.append_log(f"提取失败: {message}")
        QMessageBox.warning(self, "提取失败", message)

    def set_busy(self, busy: bool) -> None:
        self.drop_zone.setEnabled(not busy)
        self.recursive_checkbox.setEnabled(not busy)
        self.infer_manual_checkbox.setEnabled(not busy)
        self.select_folder_button.setEnabled(not busy)
        self.select_files_button.setEnabled(not busy)
        self.reset_button.setEnabled(not busy)
        self.status_label.setText("正在提取订单" if busy else self.status_label.text())

    @Slot()
    def reset_view(self) -> None:
        if self.worker and self.worker.isRunning():
            QMessageBox.information(self, "正在处理", "请等待当前提取完成。")
            return
        self.last_result = None
        self.progress_bar.setValue(0)
        self.current_file_label.setText("当前文件：-")
        self.count_label.setText("文件：0 | 成功：0 | 失败：0 | 跳过：0")
        self.status_label.setText("等待拖入订单文件夹或 Excel 文件")
        self.log_view.clear()
        self.open_workbook_button.setEnabled(False)
        self.open_folder_button.setEnabled(False)

    @Slot()
    def open_output_workbook(self) -> None:
        if self.last_result:
            QDesktopServices.openUrl(QUrl.fromLocalFile(str(self.last_result.outputs.xlsx_output)))

    @Slot()
    def open_output_folder(self) -> None:
        if self.last_result:
            QDesktopServices.openUrl(QUrl.fromLocalFile(str(self.last_result.outputs.output_dir)))


def main() -> int:
    if "--smoke-test" in sys.argv:
        return run_smoke_test()
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    window = OrderExtractionWindow()
    window.show()
    return app.exec()


def run_smoke_test() -> int:
    app = QApplication.instance() or QApplication(sys.argv)
    window = OrderExtractionWindow()
    print(window.windowTitle())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
