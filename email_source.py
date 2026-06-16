from __future__ import annotations

import imaplib
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email import message_from_bytes
from email.header import decode_header, make_header
from email.message import Message
from email.policy import default
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Protocol


DEFAULT_IMAP_SERVER = "imap.exmail.qq.com"
DEFAULT_IMAP_PORT = 993
SUPPORTED_EXCEL_SUFFIXES = {".xlsx", ".xlsm"}


@dataclass(frozen=True)
class EmailSettings:
    email: str = ""
    auth_code: str = ""


@dataclass(frozen=True)
class ImapConfig:
    server: str
    email: str
    auth_code: str
    port: int = DEFAULT_IMAP_PORT


@dataclass(frozen=True)
class EmailAttachment:
    filename: str
    content: bytes
    message_subject: str = ""
    message_date: datetime | None = None
    message_uid: str = ""


@dataclass(frozen=True)
class EmailFetchResult:
    files: list[Path]
    scanned_messages: int
    attachment_count: int
    download_dir: Path


class AttachmentClient(Protocol):
    def fetch_excel_attachments(self, hours: int | None = None) -> tuple[list[EmailAttachment], int]:
        pass


class NoEmailAttachmentsError(RuntimeError):
    pass


def app_config_dir() -> Path:
    return Path.home() / ".order_organizer_assistant"


def default_email_settings_path() -> Path:
    return app_config_dir() / "email_settings.json"


def default_email_download_root() -> Path:
    return app_config_dir() / "email_attachments"


def load_email_settings(path: Path | None = None) -> EmailSettings:
    settings_path = path or default_email_settings_path()
    if not settings_path.exists():
        return EmailSettings()

    try:
        raw = json.loads(settings_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return EmailSettings()

    if not isinstance(raw, dict):
        return EmailSettings()
    return EmailSettings(email=str(raw.get("email", "")).strip(), auth_code=str(raw.get("auth_code", "")))


def save_email_settings(settings: EmailSettings, path: Path | None = None) -> None:
    settings_path = path or default_email_settings_path()
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    settings_path.write_text(
        json.dumps({"email": settings.email.strip(), "auth_code": settings.auth_code}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def imap_since_date(cutoff: datetime) -> str:
    return cutoff.strftime("%d-%b-%Y")


def is_excel_attachment_name(filename: str) -> bool:
    return Path(filename).suffix.lower() in SUPPORTED_EXCEL_SUFFIXES


def parse_message_date(message: Message) -> datetime | None:
    raw_date = message.get("Date")
    if not raw_date:
        return None
    parsed = parsedate_to_datetime(raw_date)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def decode_mime_text(value: str | None) -> str:
    if not value:
        return ""
    return str(make_header(decode_header(value)))


def extract_excel_attachments(message: Message, message_uid: str = "") -> list[EmailAttachment]:
    subject = decode_mime_text(message.get("Subject"))
    message_date = parse_message_date(message)
    attachments: list[EmailAttachment] = []

    for part in message.walk():
        filename = part.get_filename()
        if not filename:
            continue

        decoded_filename = decode_mime_text(filename)
        if not is_excel_attachment_name(decoded_filename):
            continue

        payload = part.get_payload(decode=True)
        if payload is None:
            continue

        attachments.append(
            EmailAttachment(
                filename=decoded_filename,
                content=payload,
                message_subject=subject,
                message_date=message_date,
                message_uid=message_uid,
            )
        )

    return attachments


class ImapEmailClient:
    def __init__(self, config: ImapConfig, timeout_seconds: int = 30) -> None:
        self.config = config
        self.timeout_seconds = timeout_seconds

    def fetch_excel_attachments(self, hours: int | None = None) -> tuple[list[EmailAttachment], int]:
        cutoff = None if hours is None else datetime.now(timezone.utc) - timedelta(hours=hours)
        attachments: list[EmailAttachment] = []
        scanned_messages = 0

        mailbox = imaplib.IMAP4_SSL(self.config.server, self.config.port, timeout=self.timeout_seconds)
        try:
            _login(mailbox, self.config)
            mailbox.select("INBOX")
            if cutoff is None:
                status, data = mailbox.uid("SEARCH", None, "ALL")
            else:
                status, data = mailbox.uid("SEARCH", None, "SINCE", imap_since_date(cutoff))
            if status != "OK":
                raise RuntimeError("邮箱搜索失败")

            for message_uid in _decode_uids(data):
                status, fetch_data = mailbox.uid("FETCH", str(message_uid).encode(), "(RFC822)")
                if status != "OK":
                    continue

                for item in fetch_data:
                    if not isinstance(item, tuple):
                        continue

                    message = message_from_bytes(item[1], policy=default)
                    message_date = parse_message_date(message)
                    if cutoff is not None and message_date is not None and message_date < cutoff:
                        continue

                    scanned_messages += 1
                    attachments.extend(extract_excel_attachments(message, message_uid=str(message_uid)))
        finally:
            _logout_safely(mailbox)

        return attachments, scanned_messages


def fetch_email_order_files(
    config: ImapConfig,
    download_dir: Path,
    *,
    hours: int | None = None,
    client: AttachmentClient | None = None,
) -> EmailFetchResult:
    active_client = client or ImapEmailClient(config)
    attachments, scanned_messages = active_client.fetch_excel_attachments(hours=hours)
    if not attachments:
        raise NoEmailAttachmentsError(f"没有找到订单 Excel 附件。已扫描邮件：{scanned_messages}")

    files = save_email_attachments(attachments, download_dir)
    return EmailFetchResult(
        files=files,
        scanned_messages=scanned_messages,
        attachment_count=len(attachments),
        download_dir=download_dir,
    )


def save_email_attachments(attachments: list[EmailAttachment], target_dir: Path) -> list[Path]:
    target_dir.mkdir(parents=True, exist_ok=True)
    saved_paths: list[Path] = []
    used_names: set[str] = set()

    for attachment in attachments:
        filename = _safe_attachment_name(attachment.filename)
        filename = _dedupe_name(filename, used_names)
        used_names.add(filename)
        path = target_dir / filename
        path.write_bytes(attachment.content)
        saved_paths.append(path)

    return saved_paths


def _safe_attachment_name(filename: str) -> str:
    name = Path(filename).name.strip()
    if not name or not is_excel_attachment_name(name):
        return "attachment.xlsx"
    return name


def _dedupe_name(filename: str, used_names: set[str]) -> str:
    if filename not in used_names:
        return filename

    path = Path(filename)
    index = 2
    while True:
        candidate = f"{path.stem}-{index}{path.suffix}"
        if candidate not in used_names:
            return candidate
        index += 1


def _decode_uids(data: list[bytes]) -> list[int]:
    if not data or not data[0]:
        return []

    uids: list[int] = []
    for raw_uid in data[0].split():
        try:
            uids.append(int(raw_uid))
        except ValueError:
            continue
    return uids


def _login(mailbox, config: ImapConfig) -> None:  # type: ignore[no-untyped-def]
    try:
        mailbox.login(config.email, config.auth_code)
    except imaplib.IMAP4.error as exc:
        raise RuntimeError(_format_login_error(exc)) from exc


def _format_login_error(exc: Exception) -> str:
    raw_message = _exception_text(exc)
    if "login fail" in raw_message.lower():
        return (
            "邮箱登录失败：企业微信拒绝登录。请检查企业微信邮箱是否已开启 IMAP/SMTP 服务、"
            "授权码是否正确；如果刚连续刷新多次，可能触发登录频率限制，请等待几分钟后再试。"
        )
    return f"邮箱登录失败：{raw_message}"


def _exception_text(exc: Exception) -> str:
    if getattr(exc, "args", None):
        first_arg = exc.args[0]
        if isinstance(first_arg, bytes):
            return first_arg.decode(errors="replace")
    return str(exc)


def _logout_safely(mailbox) -> None:  # type: ignore[no-untyped-def]
    try:
        mailbox.logout()
    except (imaplib.IMAP4.abort, imaplib.IMAP4.error, OSError, EOFError):
        pass
