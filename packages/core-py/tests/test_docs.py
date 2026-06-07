import io

import pytest
from assistants_core.docs import parse_document


def test_txt():
    assert parse_document(b"hello world", "notes.txt") == "hello world"


def test_md():
    assert "Title" in parse_document(b"# Title\n\nbody", "readme.md")


def test_unsupported():
    with pytest.raises(ValueError):
        parse_document(b"\x89PNG...", "image.png")


def test_docx_roundtrip():
    from docx import Document

    doc = Document()
    doc.add_paragraph("First line")
    doc.add_paragraph("Second line")
    buf = io.BytesIO()
    doc.save(buf)

    text = parse_document(buf.getvalue(), "resume.docx")
    assert "First line" in text
    assert "Second line" in text
