import html
import logging
import os
import re
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, ZipFile

# Keep Docling/PyTorch from depending on torch.compile on Windows where possible.
# These must be set before Docling is imported. Docling itself is imported lazily
# inside the PDF/legacy Word helpers so DOCX parsing can stay deterministic.
os.environ.setdefault("TORCHINDUCTOR_DISABLE", "1")
os.environ.setdefault("TORCH_COMPILE_DISABLE", "1")

logger = logging.getLogger(__name__)

HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
INLINE_HEADING_RE = re.compile(
    r"^(?P<prefix>.+?\S)\s+(?P<marks>#{1,6})\s+(?P<title>[^#\s].{1,240})$"
)
PAGE_BREAK_MARKER = "<!-- page break -->"
IMAGE_MARKER_RE = re.compile(r"<!--\s*image\s*-->", re.IGNORECASE)
MIN_MEANINGFUL_TEXT_CHARS = 200

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W = f"{{{W_NS}}}"


def _has_meaningful_text(markdown: str) -> bool:
    meaningful_chars = sum(char.isalnum() for char in markdown)
    return meaningful_chars >= MIN_MEANINGFUL_TEXT_CHARS


def _clean_source_text(value: str) -> str:
    """
    Normalize extracted text without summarizing or rewriting it.

    The function removes Docling image placeholders, decodes HTML entities,
    trims trailing whitespace, and limits repeated blank lines. Newlines are
    intentionally preserved because they carry paragraph/list formatting.
    """
    text = html.unescape(str(value or ""))
    text = IMAGE_MARKER_RE.sub("", text)
    text = "\n".join(line.rstrip() for line in text.splitlines())
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _split_inline_markdown_headings(markdown: str) -> str:
    """
    Repair a common authoring mistake where a Markdown heading marker is typed
    at the end of a normal paragraph, for example:

        ... credit freezes. ## Introduction to Personal Cybersecurity

    That source really contains a paragraph followed by an H2 heading. Splitting
    it here prevents the heading from being swallowed into the previous section.
    """
    normalized_lines = []

    for raw_line in str(markdown or "").splitlines():
        stripped = raw_line.strip()

        # Already a proper heading; leave it untouched.
        if HEADING_RE.match(stripped):
            normalized_lines.append(raw_line)
            continue

        match = INLINE_HEADING_RE.match(stripped)
        if not match:
            normalized_lines.append(raw_line)
            continue

        prefix = match.group("prefix").rstrip()
        marks = match.group("marks")
        title = match.group("title").strip()

        # Require a meaningful prefix and title. This avoids splitting tiny
        # fragments that merely mention '#' characters.
        if len(prefix) < 3 or len(title) < 2:
            normalized_lines.append(raw_line)
            continue

        normalized_lines.append(prefix)
        normalized_lines.append(f"{marks} {title}")

    return "\n".join(normalized_lines)


def extract_sections_from_markdown(markdown: str):
    """
    Convert normalized Markdown into source-backed heading sections.

    Each returned section contains:
      index, level, title, source_text, start_page, end_page

    A section ends at the next sibling or ancestor heading. Therefore an H1
    chapter keeps all H2/H3 content underneath it, while an H2 module keeps all
    H3 subheadings/content underneath it. Nothing is summarized or invented.
    """
    markdown = _split_inline_markdown_headings(markdown)
    raw_lines = markdown.splitlines()
    has_page_markers = any(
        line.strip() == PAGE_BREAK_MARKER for line in raw_lines
    )

    lines = []
    line_pages = []
    current_page = 1

    for raw_line in raw_lines:
        if raw_line.strip() == PAGE_BREAK_MARKER:
            current_page += 1
            continue

        lines.append(raw_line)
        line_pages.append(current_page if has_page_markers else None)

    heading_rows = []

    for line_number, line in enumerate(lines):
        match = HEADING_RE.match(line.strip())
        if not match:
            continue

        title = html.unescape(match.group(2).strip())
        if not title:
            continue

        heading_rows.append(
            {
                "index": len(heading_rows),
                "line_number": line_number,
                "level": len(match.group(1)),
                "title": title,
                "start_page": line_pages[line_number],
            }
        )

    sections = []

    for position, heading in enumerate(heading_rows):
        boundary_line = len(lines)

        for candidate in heading_rows[position + 1 :]:
            if candidate["level"] <= heading["level"]:
                boundary_line = candidate["line_number"]
                break

        content_lines = lines[heading["line_number"] + 1 : boundary_line]
        source_text = _clean_source_text("\n".join(content_lines))

        end_page = heading["start_page"]
        if has_page_markers:
            for page in reversed(
                line_pages[heading["line_number"] + 1 : boundary_line]
            ):
                if page is not None:
                    end_page = page
                    break

        sections.append(
            {
                "index": heading["index"],
                "level": heading["level"],
                "title": heading["title"],
                "source_text": source_text,
                "start_page": heading["start_page"],
                "end_page": end_page,
            }
        )

    if not sections:
        cleaned_document_text = _clean_source_text(
            "\n".join(
                line
                for line in raw_lines
                if line.strip() != PAGE_BREAK_MARKER
            )
        )
        if cleaned_document_text:
            sections.append(
                {
                    "index": 0,
                    "level": 1,
                    "title": "Document Content",
                    "source_text": cleaned_document_text,
                    "start_page": 1 if has_page_markers else None,
                    "end_page": current_page if has_page_markers else None,
                }
            )

    return sections


def _extract_headings(sections):
    return [
        {
            "index": section["index"],
            "level": section["level"],
            "title": section["title"],
            "start_page": section["start_page"],
            "end_page": section["end_page"],
        }
        for section in sections
    ]


def _read_docx_style_map(zip_file: ZipFile):
    """Return Word style metadata keyed by style id."""
    try:
        root = ET.fromstring(zip_file.read("word/styles.xml"))
    except KeyError:
        return {}

    styles = {}
    for style in root.findall(f".//{W}style"):
        style_id = style.get(f"{W}styleId")
        if not style_id:
            continue

        name_node = style.find(f"{W}name")
        based_on_node = style.find(f"{W}basedOn")
        outline_node = style.find(f"./{W}pPr/{W}outlineLvl")

        styles[style_id] = {
            "name": (
                name_node.get(f"{W}val", "") if name_node is not None else ""
            ),
            "based_on": (
                based_on_node.get(f"{W}val")
                if based_on_node is not None
                else None
            ),
            "outline_level": (
                int(outline_node.get(f"{W}val"))
                if outline_node is not None
                and str(outline_node.get(f"{W}val", "")).isdigit()
                else None
            ),
        }

    return styles


def _resolve_style_outline_level(style_id, styles, seen=None):
    if not style_id or style_id not in styles:
        return None

    seen = set(seen or ())
    if style_id in seen:
        return None
    seen.add(style_id)

    style = styles[style_id]
    if style.get("outline_level") is not None:
        return style["outline_level"] + 1

    # Built-in Word heading style ids/names are highly reliable.
    for candidate in (style_id, style.get("name") or ""):
        match = re.search(r"heading\s*([1-6])$", candidate, re.IGNORECASE)
        if match:
            return int(match.group(1))

    return _resolve_style_outline_level(
        style.get("based_on"), styles, seen=seen
    )


def _docx_paragraph_heading_level(paragraph, styles):
    p_pr = paragraph.find(f"{W}pPr")
    if p_pr is None:
        return None

    direct_outline = p_pr.find(f"{W}outlineLvl")
    if direct_outline is not None:
        value = direct_outline.get(f"{W}val")
        if value is not None and str(value).isdigit():
            level = int(value) + 1
            if 1 <= level <= 6:
                return level

    style_node = p_pr.find(f"{W}pStyle")
    style_id = (
        style_node.get(f"{W}val") if style_node is not None else None
    )
    level = _resolve_style_outline_level(style_id, styles)
    if level is not None and 1 <= level <= 6:
        return level

    return None


def _docx_paragraph_text(paragraph):
    parts = []

    for node in paragraph.iter():
        if node.tag == f"{W}t":
            parts.append(node.text or "")
        elif node.tag == f"{W}tab":
            parts.append("\t")
        elif node.tag in {f"{W}br", f"{W}cr"}:
            parts.append("\n")

    return "".join(parts).strip()


def _docx_is_numbered_paragraph(paragraph):
    p_pr = paragraph.find(f"{W}pPr")
    return p_pr is not None and p_pr.find(f"{W}numPr") is not None


def _docx_table_to_markdown(table):
    rows = []

    for row in table.findall(f"./{W}tr"):
        cells = []
        for cell in row.findall(f"./{W}tc"):
            paragraphs = [
                _docx_paragraph_text(p)
                for p in cell.findall(f".//{W}p")
            ]
            value = " <br> ".join(p for p in paragraphs if p)
            value = value.replace("|", "\\|")
            cells.append(value)
        if any(cells):
            rows.append(cells)

    if not rows:
        return []

    width = max(len(row) for row in rows)
    rows = [row + [""] * (width - len(row)) for row in rows]

    result = ["| " + " | ".join(rows[0]) + " |"]
    result.append("| " + " | ".join(["---"] * width) + " |")
    for row in rows[1:]:
        result.append("| " + " | ".join(row) + " |")
    return result


def _convert_docx(source: Path):
    """
    Convert DOCX to Markdown using Word's real paragraph styles.

    This avoids guessing heading levels from visual font size. Heading 1/2/3
    styles (and custom styles with Word outline levels) are converted directly
    to #/##/###, which makes Chapter -> Module extraction deterministic.
    """
    try:
        with ZipFile(source) as zip_file:
            styles = _read_docx_style_map(zip_file)
            document_root = ET.fromstring(zip_file.read("word/document.xml"))
    except (BadZipFile, KeyError, ET.ParseError) as exc:
        raise ValueError(f"Invalid or unreadable DOCX file: {exc}") from exc

    body = document_root.find(f".{W}body")
    if body is None:
        raise ValueError("DOCX file does not contain a readable document body.")

    lines = []

    for child in list(body):
        if child.tag == f"{W}p":
            text = _docx_paragraph_text(child)
            if not text:
                continue

            heading_level = _docx_paragraph_heading_level(child, styles)
            if heading_level is not None:
                lines.append(f"{'#' * heading_level} {text}")
                lines.append("")
                continue

            if _docx_is_numbered_paragraph(child):
                lines.append(f"- {text}")
            else:
                lines.append(text)
            lines.append("")

        elif child.tag == f"{W}tbl":
            lines.extend(_docx_table_to_markdown(child))
            lines.append("")

    return _split_inline_markdown_headings("\n".join(lines)).strip()


def _convert_pdf(source: Path, use_ocr: bool):
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    pipeline_options = PdfPipelineOptions()
    pipeline_options.do_ocr = use_ocr
    pipeline_options.do_table_structure = False

    converter = DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(
                pipeline_options=pipeline_options,
            )
        }
    )

    result = converter.convert(source)
    return result.document.export_to_markdown(
        page_break_placeholder=PAGE_BREAK_MARKER,
    )


def _convert_legacy_or_other(source: Path):
    from docling.document_converter import DocumentConverter

    converter = DocumentConverter()
    result = converter.convert(source)
    return result.document.export_to_markdown()


def load_processed_sections(document):
    if not document.processed_markdown_path:
        return []

    markdown_path = Path(document.processed_markdown_path)
    if not markdown_path.exists():
        return []

    markdown = markdown_path.read_text(encoding="utf-8")
    return extract_sections_from_markdown(markdown)


def parse_document(document):
    from django.conf import settings

    source = Path(document.file.path)
    extension = source.suffix.lower()

    if extension == ".pdf":
        logger.info(
            "LocalMind: trying PDF extraction without OCR for %s",
            document.original_name,
        )

        markdown = _convert_pdf(source, use_ocr=False)

        if _has_meaningful_text(markdown):
            parse_mode = "fast_no_ocr"
        else:
            logger.info(
                "LocalMind: insufficient text; retrying with OCR for %s",
                document.original_name,
            )
            markdown = _convert_pdf(source, use_ocr=True)
            parse_mode = "ocr_fallback"

    elif extension == ".docx":
        logger.info(
            "LocalMind: reading DOCX heading styles directly for %s",
            document.original_name,
        )
        markdown = _convert_docx(source)
        parse_mode = "docx_style_hierarchy"

    else:
        # Legacy .doc remains on Docling because it is not an OOXML ZIP file.
        markdown = _convert_legacy_or_other(source)
        parse_mode = "standard"

    markdown = _split_inline_markdown_headings(markdown)

    if not markdown.strip():
        raise ValueError(
            "No readable content could be extracted from this document."
        )

    processed_dir = Path(settings.MEDIA_ROOT) / "processed" / str(document.id)
    processed_dir.mkdir(parents=True, exist_ok=True)

    markdown_path = processed_dir / "document.md"
    markdown_path.write_text(markdown, encoding="utf-8")

    sections = extract_sections_from_markdown(markdown)
    headings = _extract_headings(sections)

    logger.info(
        "LocalMind: processing complete. mode=%s headings=%s sections=%s",
        parse_mode,
        len(headings),
        len(sections),
    )

    return {
        "markdown": markdown,
        "markdown_path": str(markdown_path),
        "headings": headings,
        "sections": sections,
        "parse_mode": parse_mode,
    }
