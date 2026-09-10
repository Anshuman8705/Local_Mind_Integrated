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
from django.db.models import Q

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


def _has_meaningful_text(text):
    return sum(c.isalnum() for c in str(text or "")) >= 200


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
    # Headings that come before the first chapter-level heading (a preface or
    # introduction written as H2 ahead of the first H1) would otherwise be
    # dropped, and their text with them. Promote them to chapters of their own.
    first_chapter_index = chapter_sections[0]["index"]
    leading = [s for s in sections if s["index"] < first_chapter_index and s.get("source_text", "").strip()]
    if leading:
        leading_level = min(s["level"] for s in leading)
        chapter_sections = [s for s in leading if s["level"] == leading_level] + chapter_sections

    chapters = []
    for pos, ch in enumerate(chapter_sections):
        next_index = chapter_sections[pos + 1]["index"] if pos + 1 < len(chapter_sections) else float("inf")
        nested = [s for s in sections if ch["index"] < s["index"] < next_index and s["level"] > ch["level"]]
        modules = []
        if nested:
            module_level = min(s["level"] for s in nested)
            modules = [{"title": clean_title(s["title"]), "source_heading_index": s["index"]}
                       for s in nested if s["level"] == module_level]
        if modules and _has_meaningful_text(ch.get("own_text", "")):
            # The chapter's own introduction, written before its first
            # sub-heading, would otherwise be invisible to students (they read
            # modules, not chapters). Keep it as the chapter's first module.
            modules.insert(0, {"title": f"{clean_title(ch['title'])}: Overview", "source_text": ch["own_text"],
                               "start_page": ch.get("start_page"), "end_page": ch.get("end_page")})
        if not modules:
            # A chapter with no sub-headings (a flat document, or a short
            # chapter written as one block) still needs something a student can
            # open, and a book with no modules at all cannot be published. The
            # chapter's own text becomes its single module.
            modules = [{"title": clean_title(ch["title"]), "source_heading_index": ch["index"]}]
        chapters.append({"title": clean_title(ch["title"]), "source_heading_index": ch["index"], "modules": modules})
    title = chapters[0]["title"] if len(chapters) == 1 else Path(original_name).stem
    return {"document_title": title, "chapters": chapters}


def ai_outline(document, headings):
    """Ask the model to group indexed headings. Returns None on any failure."""
    if not headings:
        return None
    heading_text = "\n".join(f'[{h["index"]}] level {h["level"]}: {h["title"]}' for h in headings[:600])
    system = ("You organise a textbook's headings into a course outline of chapters that contain modules. "
              "Every source_heading_index must be one of the bracketed numbers in the list; never invent an index and never "
              "use the same index twice. Keep the document order. Output JSON only.")
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
    result = gateway().generate(task="outline", system_prompt=system, user_prompt=user,
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


def _resolved_text(existing, data, lookup) -> str:
    """The text a module or chapter will carry after ``_fill_from_section``,
    worked out without touching the instance. Same precedence: a resolvable
    heading, then explicit text, then what an existing row already has."""
    idx = data.get("source_heading_index")
    section = lookup.get(int(idx)) if idx is not None and str(idx).lstrip("-").isdigit() else None
    if section:
        return section.get("source_text", "") or ""
    if "source_text" in data and data.get("source_text") is not None:
        return str(data.get("source_text") or "")
    if existing is not None and existing.pk and existing.source_text:
        return existing.source_text
    return ""


@transaction.atomic
def persist_outline(document, outline, sections, user_edited=False):
    """Create or reconcile Chapter/Module rows from an outline.

    Rows whose id appears in the outline are updated in place so that
    assessments, progress and conversations keep pointing at the same module.
    Rows omitted from the outline are deleted only if nothing references them.

    A module with no source text never becomes part of the book: a new one is
    not created, and an existing one whose text resolves to nothing is removed.
    The single exception is a module that quizzes, assignments or student work
    already refer to, which cannot be deleted; it is kept with
    ``source_missing`` set and is hidden from students. A chapter left with no
    modules is removed with them. Returns a report of what was dropped so the
    caller can tell the person who saved.
    """
    chapters_data = outline.get("chapters") or []
    if not chapters_data:
        raise ValidationFailed("The outline must contain at least one chapter.", code="EMPTY_OUTLINE")
    lookup = section_lookup(sections or [])

    existing_chapters = {str(c.id): c for c in document.chapters.all()}
    existing_modules = {str(m.id): m for m in Module.objects.filter(chapter__document=document)}
    report = {"removed_empty_modules": [], "hidden_empty_modules": [], "removed_empty_chapters": []}

    # Decide what survives before writing anything, so chapter and module
    # orders stay contiguous and an outline with no text at all is refused
    # without half-applying it.
    plan = []
    for c_pos, cdata in enumerate(chapters_data, start=1):
        title = clean_title(cdata.get("title"))
        if not title:
            raise ValidationFailed(f"Chapter {c_pos} needs a title.", code="MISSING_TITLE")
        kept = []
        for m_pos, mdata in enumerate(cdata.get("modules") or [], start=1):
            mtitle = clean_title(mdata.get("title"))
            if not mtitle:
                raise ValidationFailed(f'Module {m_pos} in "{title}" needs a title.', code="MISSING_TITLE")
            existing = existing_modules.get(str(mdata.get("id") or ""))
            if _resolved_text(existing, mdata, lookup).strip():
                kept.append((mdata, mtitle, existing, False))
            elif existing is not None and _module_is_referenced(existing):
                kept.append((mdata, mtitle, existing, True))
                report["hidden_empty_modules"].append({"id": str(existing.id), "title": mtitle, "chapter": title})
            else:
                report["removed_empty_modules"].append({"id": str(existing.id) if existing else None, "title": mtitle, "chapter": title})
        existing_chapter = existing_chapters.get(str(cdata.get("id") or ""))
        if not kept and not user_edited:
            # Processing only: a planned chapter whose modules all came out
            # empty (or that the planner gave no modules) still has its own
            # text, which becomes its single module, as the heading-based
            # outline already does for a chapter with no sub-headings. A person
            # editing the outline gets exactly the modules they kept.
            chapter_text = _resolved_text(existing_chapter, cdata, lookup)
            if chapter_text.strip():
                kept.append(({"title": title, "source_heading_index": cdata.get("source_heading_index"), "source_text": chapter_text},
                             title, None, False))
                report["removed_empty_modules"] = [m for m in report["removed_empty_modules"] if m["chapter"] != title or m["id"]]
        if not kept and not (existing_chapter is not None and _chapter_has_own_references(existing_chapter)):
            report["removed_empty_chapters"].append({"id": str(existing_chapter.id) if existing_chapter else None, "title": title})
            continue
        plan.append((cdata, title, existing_chapter, kept))

    if not any(not hidden for _, _, _, kept in plan for *_rest, hidden in kept):
        raise ValidationFailed(
            "None of the modules in this outline has source text. A module needs text from the book, or text "
            "typed in, before it can be kept.", code="NO_SOURCE_TEXT",
            details={"removed_empty_modules": [m["title"] for m in report["removed_empty_modules"]]})

    # Two-pass ordering avoids unique(order) collisions while reordering.
    for c in existing_chapters.values():
        Chapter.objects.filter(pk=c.pk).update(order=c.order + 100000)
    for m in existing_modules.values():
        Module.objects.filter(pk=m.pk).update(order=m.order + 100000)

    kept_chapter_ids, kept_module_ids = set(), set()
    for c_order, (cdata, title, existing_chapter, kept) in enumerate(plan, start=1):
        chapter = existing_chapter or Chapter(document=document)
        chapter.title = title
        chapter.order = c_order
        chapter.is_user_edited = user_edited or chapter.is_user_edited
        _fill_from_section(chapter, cdata, lookup)
        chapter.save()
        kept_chapter_ids.add(str(chapter.id))

        for m_order, (mdata, mtitle, existing, hidden) in enumerate(kept, start=1):
            module = existing if existing is not None else Module(chapter=chapter)
            module.chapter = chapter
            module.title = mtitle
            module.order = m_order
            module.is_user_edited = user_edited or module.is_user_edited
            _fill_from_section(module, mdata, lookup)
            module.source_missing = not module.source_text.strip()
            module.save()
            kept_module_ids.add(str(module.id))

    dropped_empty = {m["id"] for m in report["removed_empty_modules"] if m["id"]}
    for mid, module in existing_modules.items():
        if mid not in kept_module_ids:
            if mid not in dropped_empty and _module_is_referenced(module):
                raise Conflict(f'Module "{module.title}" has student activity and cannot be removed; unpublish and archive instead.',
                               code="MODULE_IN_USE", details={"module_id": mid})
            module.delete()
    for cid, chapter in existing_chapters.items():
        if cid not in kept_chapter_ids:
            if _chapter_is_referenced(chapter):
                raise Conflict(f'Chapter "{chapter.title}" has a quiz or assignment built on it and cannot be removed.',
                               code="CHAPTER_IN_USE", details={"chapter_id": cid})
            chapter.delete()

    document.title = clean_title(outline.get("document_title")) or document.title
    document.save(update_fields=["title", "updated_at"])
    return report


def _module_is_referenced(module):
    """Anything that would lose meaning, or fail, if the module were deleted:
    progress, a quiz or assignment written on it (directly or as one of several
    chosen modules), or a tutor conversation a student had about it."""
    if not module.pk:
        return False
    if module.progress.exists():
        return True
    from assessments.models import Assessment
    from assignments.models import Assignment
    from tutor.models import Conversation

    return (Assessment.objects.filter(Q(module=module) | Q(source_modules=module)).exists()
            or Assignment.objects.filter(Q(module=module) | Q(source_modules=module)).exists()
            or Conversation.objects.filter(module=module).exists())


def _chapter_has_own_references(chapter):
    """A chapter-level quiz or assignment points at the chapter itself, and the
    database protects it from deletion."""
    if not chapter.pk:
        return False
    from assessments.models import Assessment
    from assignments.models import Assignment

    return Assessment.objects.filter(chapter=chapter).exists() or Assignment.objects.filter(chapter=chapter).exists()


def _chapter_is_referenced(chapter):
    """Own references, or a referenced module still inside it."""
    if _chapter_has_own_references(chapter):
        return True
    return any(_module_is_referenced(m) for m in chapter.modules.all())


def missing_source_modules(document):
    return list(Module.objects.filter(chapter__document=document, source_missing=True).values("id", "title", "chapter__title"))
