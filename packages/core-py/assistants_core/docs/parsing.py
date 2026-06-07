"""Real document parsing (PDF/DOCX/TXT/MD).

Fixes the prototype bug where binary docs were read with `File.text()` and arrived as garbage —
here PDFs go through pypdf and DOCX through python-docx.
"""

from __future__ import annotations

import io

SUPPORTED = ("pdf", "docx", "txt", "md", "markdown")


def _ext(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def parse_document(data: bytes, filename: str) -> str:
    """Extract plain text from `data`, dispatching on the extension of `filename`."""
    ext = _ext(filename)
    if ext == "pdf":
        return _parse_pdf(data)
    if ext == "docx":
        return _parse_docx(data)
    if ext in ("txt", "md", "markdown"):
        return data.decode("utf-8", errors="replace")
    raise ValueError(f"Unsupported document type: .{ext or '?'} (supported: {', '.join(SUPPORTED)})")


def _parse_pdf(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    return "\n".join((page.extract_text() or "") for page in reader.pages).strip()


def _parse_docx(data: bytes) -> str:
    from docx import Document

    document = Document(io.BytesIO(data))
    return "\n".join(p.text for p in document.paragraphs).strip()
