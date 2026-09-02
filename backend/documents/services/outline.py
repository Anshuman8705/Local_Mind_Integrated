"""Outline construction with deterministic source mapping.

Every chapter and module in an outline carries a `source_heading_index` that
points at a section produced by the parser. Source text is always copied from
that section, never from a title match. The AI is only asked to *group and
label* headings it is given by index; anything it returns that does not
reference a real index is discarded and the source hierarchy is used instead.
"""
import html
import logging
from pathlib import Path

from django.db import transaction

from ai.gateway import gateway
from core.exceptions import Conflict, ValidationFailed
from learning.models import Chapter, Module

logger = logging.getLogger("localmind.outline")

OUTLINE_SCHEMA = {
    "type": "object",
    "properties": {
        "document_title": {"type": "string"},
        "chapters": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "source_heading_index": {"type": "integer"},
                    "modules": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string"},
                                "source_heading_index": {"type": "integer"},
                            },
                            "required": ["title", "source_heading_index"],
                        },
                    },
                },
                "required": ["title", "source_heading_index", "modules"],
            },
        },
    },
    "required": ["document_title", "chapters"],
}


def clean_title(value):
    return " ".join(html.unescape(str(value or "")).split()).strip()


def section_lookup(sections):
    return {int(s["index"]): s for s in sections}


def source_hierarchy_outline(original_name, sections):
    """Shallowest heading level → chapters; next level inside each → modules."""
    if not sections:
        raise ValidationFailed("No source sections are available to build an outline.", code="NO_SECTIONS")
    levels = [s["level"] for s in sections if s.get("level")]
    chapter_level = min(levels)
    chapter_sections = [s for s in sections if s["level"] == chapter_level] or [sections[0]]

    chapters = []
    for pos, ch in enumerate(chapter_sections):
        next_index = chapter_sections[pos + 1]["index"] if pos + 1 < len(chapter_sections) else float("inf")
        nested = [s for s in sections if ch["index"] < s["index"] < next_index and s["level"] > chapter_level]
        modules = []
        if nested:
            module_level = min(s["level"] for s in nested)
            modules = [{"title": clean_title(s["title"]), "source_heading_index": s["index"]}
                       for s in nested if s["level"] == module_level]
        chapters.append({"title": clean_title(ch["title"]), "source_heading_index": ch["index"], "modules": modules})
    title = chapters[0]["title"] if len(chapters) == 1 else Path(original_name).stem
    return {"document_title": title, "chapters": chapters}


def ai_outline(document, headings):
    """Ask the model to group indexed headings. Returns None on any failure."""
    if not headings:
        return None
    heading_text = "\n".join(f'[{h["index"]}] level {h["level"]}: {h["title"]}' for h in headings[:600])
    system = "You organise a textbook's headings into a course outline. You only reuse the heading indices you are given."
    user = f"""File name: {document.original_name}

Headings (index in brackets):
{heading_text}

Produce a course outline as chapters containing modules.
Rules:
1. Every chapter and module MUST reference one of the given heading indices in source_heading_index.
2. Do not invent topics. Do not reference indices that were not listed.
3. Keep the document order.
4. Chapters are the top-level divisions; modules are the sections a student studies in one sitting.
5. Titles may be tidied but must keep the heading's meaning.
"""
    result = gateway().generate(purpose="outline", system_prompt=system, user_prompt=user,
                                schema=OUTLINE_SCHEMA, model_kind="outline", temperature=0.0, timeout=180)
    if result.failed:
        return None
    valid = {h["index"] for h in headings}
    used = set()
    chapters = []
    for ch in result.data["chapters"]:
        ci = ch["source_heading_index"]
        if ci not in valid or ci in used:
            logger.warning("AI outline referenced invalid/duplicate chapter index %s; discarding AI outline", ci)
            return None
        used.add(ci)
        modules = []
        for m in ch.get("modules", []):
            mi = m["source_heading_index"]
            if mi not in valid or mi in used:
                logger.warning("AI outline referenced invalid/duplicate module index %s; discarding AI outline", mi)
                return None
            used.add(mi)
            modules.append({"title": clean_title(m["title"]) or clean_title(next(h["title"] for h in headings if h["index"] == mi)),
                            "source_heading_index": mi})
        chapters.append({"title": clean_title(ch["title"]), "source_heading_index": ci, "modules": modules})
    if not chapters:
        return None
    return {"document_title": clean_title(result.data.get("document_title")) or document.title, "chapters": chapters}


def build_proposed_outline(document, sections, headings):
    outline = ai_outline(document, headings)
    if outline:
        return outline, "ai"
    return source_hierarchy_outline(document.original_name, sections), "source_hierarchy"


def _fill_from_section(target, data, lookup):
    idx = data.get("source_heading_index")
    section = lookup.get(int(idx)) if idx is not None and str(idx).lstrip("-").isdigit() else None
    if section:
        target.source_heading_index = section["index"]
        target.source_text = section.get("source_text", "")
        target.start_page = section.get("start_page")
        target.end_page = section.get("end_page")
    elif "source_text" in data and data.get("source_text") is not None:
        # Explicit, reviewer-supplied text.
        target.source_heading_index = None
        target.source_text = str(data.get("source_text") or "")
        target.start_page = data.get("start_page")
        target.end_page = data.get("end_page")
    elif target.pk and target.source_text:
        # Existing row, no resolvable section, nothing explicit: keep what it has.
        pass
    else:
        target.source_heading_index = None
        target.source_text = ""


@transaction.atomic
def persist_outline(document, outline, sections, user_edited=False):
    """Create or reconcile Chapter/Module rows from an outline.

    Rows whose id appears in the outline are updated in place so that
    assessments, progress and conversations keep pointing at the same module.
    Rows omitted from the outline are deleted only if nothing references them.
    """
    chapters_data = outline.get("chapters") or []
    if not chapters_data:
        raise ValidationFailed("The outline must contain at least one chapter.", code="EMPTY_OUTLINE")
    lookup = section_lookup(sections or [])

    existing_chapters = {str(c.id): c for c in document.chapters.all()}
    existing_modules = {str(m.id): m for m in Module.objects.filter(chapter__document=document)}
    kept_chapter_ids, kept_module_ids = set(), set()

    # Two-pass ordering avoids unique(order) collisions while reordering.
    for c in existing_chapters.values():
        Chapter.objects.filter(pk=c.pk).update(order=c.order + 100000)
    for m in existing_modules.values():
        Module.objects.filter(pk=m.pk).update(order=m.order + 100000)

    for c_order, cdata in enumerate(chapters_data, start=1):
        title = clean_title(cdata.get("title"))
        if not title:
            raise ValidationFailed(f"Chapter {c_order} needs a title.", code="MISSING_TITLE")
        chapter = existing_chapters.get(str(cdata.get("id") or "")) or Chapter(document=document)
        chapter.title = title
        chapter.order = c_order
        chapter.is_user_edited = user_edited or chapter.is_user_edited
        _fill_from_section(chapter, cdata, lookup)
        chapter.save()
        kept_chapter_ids.add(str(chapter.id))

        for m_order, mdata in enumerate(cdata.get("modules") or [], start=1):
            mtitle = clean_title(mdata.get("title"))
            if not mtitle:
                raise ValidationFailed(f'Module {m_order} in "{title}" needs a title.', code="MISSING_TITLE")
            module = existing_modules.get(str(mdata.get("id") or ""))
            if module is None:
                module = Module(chapter=chapter)
            else:
                module.chapter = chapter
            module.title = mtitle
            module.order = m_order
            module.is_user_edited = user_edited or module.is_user_edited
            _fill_from_section(module, mdata, lookup)
            module.source_missing = not module.source_text.strip()
            module.save()
            kept_module_ids.add(str(module.id))

    for mid, module in existing_modules.items():
        if mid not in kept_module_ids:
            if _module_is_referenced(module):
                raise Conflict(f'Module "{module.title}" has student activity and cannot be removed; unpublish and archive instead.',
                               code="MODULE_IN_USE", details={"module_id": mid})
            module.delete()
    for cid, chapter in existing_chapters.items():
        if cid not in kept_chapter_ids:
            chapter.delete()

    document.title = clean_title(outline.get("document_title")) or document.title
    document.save(update_fields=["title", "updated_at"])


def _module_is_referenced(module):
    if module.progress.exists():
        return True
    try:
        from assessments.models import Assessment
        if Assessment.objects.filter(module=module).exists():
            return True
    except Exception:  # app not yet migrated in early phases
        pass
    return False


def missing_source_modules(document):
    return list(Module.objects.filter(chapter__document=document, source_missing=True).values("id", "title", "chapter__title"))
