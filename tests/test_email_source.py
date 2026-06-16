from __future__ import annotations

from email.message import EmailMessage
from pathlib import Path

import pytest

from email_source import (
    EmailAttachment,
    EmailSettings,
    ImapConfig,
    NoEmailAttachmentsError,
    extract_excel_attachments,
    fetch_email_order_files,
    load_email_settings,
    save_email_settings,
    save_email_attachments,
)


def make_message() -> EmailMessage:
    message = EmailMessage()
    message["Subject"] = "订单邮件"
    message["Date"] = "Tue, 16 Jun 2026 10:00:00 +0800"
    message.set_content("body")
    message.add_attachment(
        b"excel-bytes",
        maintype="application",
        subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename="订单.xlsx",
    )
    message.add_attachment(
        b"ignore",
        maintype="text",
        subtype="plain",
        filename="notes.txt",
    )
    return message


def test_extract_excel_attachments_keeps_excel_only_and_metadata() -> None:
    attachments = extract_excel_attachments(make_message(), message_uid="42")

    assert len(attachments) == 1
    attachment = attachments[0]
    assert attachment.filename == "订单.xlsx"
    assert attachment.content == b"excel-bytes"
    assert attachment.message_subject == "订单邮件"
    assert attachment.message_uid == "42"
    assert attachment.message_date is not None


def test_save_email_attachments_sanitizes_names_and_deduplicates(tmp_path: Path) -> None:
    attachments = [
        EmailAttachment(filename="../../order.xlsx", content=b"one"),
        EmailAttachment(filename="order.xlsx", content=b"two"),
    ]

    paths = save_email_attachments(attachments, tmp_path)

    assert [path.name for path in paths] == ["order.xlsx", "order-2.xlsx"]
    assert [path.read_bytes() for path in paths] == [b"one", b"two"]
    assert all(path.parent == tmp_path for path in paths)


def test_fetch_email_order_files_uses_client_and_saves_attachments(tmp_path: Path) -> None:
    class FakeClient:
        def __init__(self) -> None:
            self.hours = object()

        def fetch_excel_attachments(self, hours: int | None = None) -> tuple[list[EmailAttachment], int]:
            self.hours = hours
            return [EmailAttachment(filename="order.xlsx", content=b"excel")], 3

    client = FakeClient()

    result = fetch_email_order_files(
        ImapConfig(server="imap.example.com", email="user@example.com", auth_code="secret"),
        tmp_path,
        hours=24,
        client=client,
    )

    assert client.hours == 24
    assert result.scanned_messages == 3
    assert result.attachment_count == 1
    assert [path.name for path in result.files] == ["order.xlsx"]
    assert result.files[0].read_bytes() == b"excel"


def test_fetch_email_order_files_raises_clear_error_when_no_attachments(tmp_path: Path) -> None:
    class EmptyClient:
        def fetch_excel_attachments(self, hours: int | None = None) -> tuple[list[EmailAttachment], int]:
            return [], 2

    with pytest.raises(NoEmailAttachmentsError, match="没有找到订单 Excel 附件"):
        fetch_email_order_files(
            ImapConfig(server="imap.example.com", email="user@example.com", auth_code="secret"),
            tmp_path,
            client=EmptyClient(),
        )


def test_email_settings_round_trip(tmp_path: Path) -> None:
    path = tmp_path / "settings.json"

    save_email_settings(EmailSettings(email="user@example.com", auth_code="secret"), path)

    assert load_email_settings(path) == EmailSettings(email="user@example.com", auth_code="secret")
