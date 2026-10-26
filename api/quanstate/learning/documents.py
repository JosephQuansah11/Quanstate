"""Document ingestion: turn a file upload into clean learning text."""

from __future__ import annotations

import io
import json
import re
import zipfile
from html import unescape
from pathlib import PurePath

from .text import clean_text, extract_srt_cues

SUPPORTED_EXTENSIONS = (
    ".txt",
    ".md",
    ".markdown",
    ".srt",
    ".vtt",
    ".csv",
    ".tsv",
    ".json",
    ".html",
    ".htm",
    ".docx",
    ".pdf",
)

MAX_DOCUMENT_BYTES = 20 * 1024 * 1024
_HTML_TAG = re.compile(r"<[^>]+>")
_DOCX_TEXT = re.compile(r"<w:t[^>]*>(.*?)</w:t>", re.DOTALL)
_DOCX_BREAK = re.compile(r"</w:p>")


class DocumentError(ValueError):
    pass


def _decode(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-16", "latin-1"):
        try:
            return data.decode(encoding)
        except (UnicodeDecodeError, LookupError):
            continue
    return data.decode("utf-8", errors="replace")


def _from_json(text: str) -> str:
    try:
        payload = json.loads(text)
    except ValueError:
        return text

    lines: list[str] = []

    def walk(node: object) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                if isinstance(value, str) and key.lower() in {"text", "content", "translation", "source", "target", "sentence"}:
                    lines.append(value)
                else:
                    walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)
        elif isinstance(node, str):
            lines.append(node)

    walk(payload)
    return "\n".join(lines) if lines else text


def _from_docx(data: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            xml = archive.read("word/document.xml").decode("utf-8", errors="replace")
    except (KeyError, zipfile.BadZipFile, OSError) as exc:
        raise DocumentError("not a valid .docx file") from exc
    xml = _DOCX_BREAK.sub("\n", xml)
    paragraphs = [unescape(_HTML_TAG.sub("", chunk)) for chunk in _DOCX_TEXT.findall(xml)]
    return "\n".join(paragraph for paragraph in paragraphs if paragraph.strip())


def _from_pdf(data: bytes) -> str:
    try:
        from pypdf import PdfReader  # type: ignore[import-not-found]
    except ImportError as exc:  # pragma: no cover - optional extra
        raise DocumentError("PDF ingestion needs the optional 'pypdf' dependency (pip install 'quanstate[pdf]')") from exc
    try:
        reader = PdfReader(io.BytesIO(data))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception as exc:  # pragma: no cover - depends on the PDF
        raise DocumentError(f"could not read PDF: {exc}") from exc


def extract_document_text(filename: str, data: bytes) -> tuple[str, str]:
    """Return ``(text, kind)`` for a supported upload."""

    if len(data) > MAX_DOCUMENT_BYTES:
        raise DocumentError(f"documents are limited to {MAX_DOCUMENT_BYTES // (1024 * 1024)} MB")
    suffix = PurePath(filename or "upload.txt").suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise DocumentError(f"unsupported file type {suffix or '(none)'}; supported: {', '.join(SUPPORTED_EXTENSIONS)}")

    if suffix == ".docx":
        return clean_text(_from_docx(data)), "docx"
    if suffix == ".pdf":
        return clean_text(_from_pdf(data)), "pdf"

    text = _decode(data)
    if suffix in {".html", ".htm"}:
        text = unescape(_HTML_TAG.sub(" ", text))
    elif suffix == ".json":
        text = _from_json(text)
    elif suffix in {".srt", ".vtt"}:
        text = "\n".join(extract_srt_cues(text))
    return clean_text(text), suffix.lstrip(".")
