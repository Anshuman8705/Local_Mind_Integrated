"""New books: garbled titles repaired and textbook boxes folded into their
sections. Existing books: the same on request, leaving student work alone."""
import shutil
import tempfile
from io import StringIO
from unittest.mock import patch

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings

from core.testing import assign, client_for, enroll, make_faculty, make_published_document, make_student, make_subject
from learning.models import Chapter, Module, ModuleProgress

from .services.outline import plan_merges, tidy_existing_document, tidy_heading_title
from .services.parser import _extract_headings, extract_sections_from_markdown

MEDIA = tempfile.mkdtemp(prefix="tidy-media-")
LONG = "Living organisms need energy to carry out life processes. " * 40
MID = "Autotrophs make their own food using simple inorganic substances. " * 30

NCERT_MD = f"""# Life Processes

## 5.1 WHA 5.1 WHAT ARE LIFE PROCESSES? T ARE LIFE PROCESSES?

{LONG}

## Q U E S T I O N S

1. Why is diffusion insufficient to meet the oxygen requirements of multi-cellular organisms?
2. What criteria do we use to decide whether something is alive?

## 5.2 NUTRITION 5.2 NUTRITION

When we walk or ride a bicycle, we are using up energy.

## 5.2.1 Autotrophic Nutrition

{MID}

## Activity 5.3 Activity 5.3

Take a potted plant with variegated leaves. Keep it in a dark room for three days.

## 5.2.2 Heterotrophic Nutrition

{MID.replace("Autotrophs make their own food", "Heterotrophs depend on others for food")}

## Do You Know?

Some plants like Cuscuta are parasites.
"""


def ncert_parse(document):
    sections = extract_sections_from_markdown(NCERT_MD)
    return {"markdown": NCERT_MD, "markdown_path": "", "headings": _extract_headings(sections), "sections": sections, "parse_mode": "test"}


class TitleRepairTests(TestCase):
    def test_the_three_garbled_shapes(self):
        self.assertEqual(tidy_heading_title("5.1 WHA 5.1 WHAT ARE LIFE PROCESSES? T ARE LIFE PROCESSES?"), "5.1 WHAT ARE LIFE PROCESSES?")
        self.assertEqual(tidy_heading_title("Q U E S T I O N S"), "QUESTIONS")
        self.assertEqual(tidy_heading_title("M O R E  T O  K N O W"), "MORE TO KNOW")
        self.assertEqual(tidy_heading_title("Activity 5.3 Activity 5.3"), "Activity 5.3")

    def test_normal_titles_are_untouched(self):
        for title in ("5.2.1 Autotrophic Nutrition", "A B", "How do living things get their food?", "Photosynthesis"):
            self.assertEqual(tidy_heading_title(title), title)


class PlanTests(TestCase):
    @staticmethod
    def items(rows):
        return [dict(key=i, chapter=c, title=t, text=x, locked=lock) for i, (c, t, x, lock) in enumerate(rows)]

    def names(self, rows, plan):
        return [(rows[s][1], mode, rows[d][1]) for s, d, mode in plan]

    def test_boxes_join_the_section_before_and_a_section_intro_joins_the_section_it_opens(self):
        rows = [(0, "5.1 What are life processes?", LONG, False), (0, "QUESTIONS", "q" * 300, False),
                (0, "5.2 NUTRITION", "n" * 60, False), (0, "5.2.1 Autotrophic Nutrition", MID, False),
                (0, "Activity 5.3", "a" * 700, False)]
        self.assertEqual(self.names(rows, plan_merges(self.items(rows), 500, 12000)), [
            ("QUESTIONS", "append", "5.1 What are life processes?"),
            ("Activity 5.3", "append", "5.2.1 Autotrophic Nutrition"),
            ("5.2 NUTRITION", "prepend", "5.2.1 Autotrophic Nutrition")])

    def test_a_chapter_made_only_of_a_box_joins_the_previous_chapter(self):
        rows = [(0, "Real section", LONG, False), (1, "Do You Know?", "d" * 100, False)]
        self.assertEqual(self.names(rows, plan_merges(self.items(rows), 500, 12000)), [("Do You Know?", "append", "Real section")])

    def test_a_box_opening_a_chapter_joins_the_next_section_of_that_chapter(self):
        rows = [(0, "Earlier chapter", LONG, False), (1, "Activity 6.1", "a" * 200, False), (1, "6.1 Real", LONG, False)]
        self.assertEqual(self.names(rows, plan_merges(self.items(rows), 500, 12000)), [("Activity 6.1", "prepend", "6.1 Real")])

    def test_size_limit_and_locked_modules(self):
        rows = [(0, "Big", "b" * 11900, False), (0, "Activity 5.5", "a" * 900, False), (0, "Do You Know?", "d" * 50, True),
                (0, "QUESTIONS", "q" * 300, False)]
        # 900 characters would push Big past the cap; a locked box is neither
        # folded nor a home for others; a few lines of questions always fit.
        self.assertEqual(self.names(rows, plan_merges(self.items(rows), 500, 12000)), [("QUESTIONS", "append", "Big")])


@override_settings(MEDIA_ROOT=MEDIA)
class NewUploadTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(MEDIA, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.faculty = make_faculty()
        self.subject = make_subject(code="NCERT")
        assign(self.faculty, self.subject)
        self.fc = client_for(self.faculty)

    def upload(self):
        from documents.tests import PDF_BYTES
        with patch("documents.services.documents.parse_document", side_effect=ncert_parse):
            res = self.fc.post("/api/faculty/documents/", {"subject_id": str(self.subject.id),
                                                          "file": SimpleUploadedFile("jesc105.pdf", PDF_BYTES, content_type="application/pdf")},
                               format="multipart")
            self.assertEqual(res.status_code, 201, res.content)
            if res.data["status"] != "under_review":
                self.fc.post(f"/api/faculty/documents/{res.data['id']}/process/")
        return res.data["id"]

    def test_boxes_are_folded_and_titles_repaired(self):
        doc_id = self.upload()
        titles = list(Module.objects.filter(chapter__document_id=doc_id).order_by("chapter__order", "order").values_list("title", flat=True))
        self.assertEqual(titles, ["5.1 WHAT ARE LIFE PROCESSES?", "5.2.1 Autotrophic Nutrition", "5.2.2 Heterotrophic Nutrition"])
        first = Module.objects.get(chapter__document_id=doc_id, title="5.1 WHAT ARE LIFE PROCESSES?")
        self.assertIn("## QUESTIONS", first.source_text)
        self.assertIn("Why is diffusion insufficient", first.source_text)
        auto = Module.objects.get(chapter__document_id=doc_id, title="5.2.1 Autotrophic Nutrition")
        self.assertTrue(auto.source_text.startswith("## 5.2 NUTRITION"))
        self.assertIn("## Activity 5.3", auto.source_text)
        hetero = Module.objects.get(chapter__document_id=doc_id, title="5.2.2 Heterotrophic Nutrition")
        self.assertIn("Cuscuta", hetero.source_text)
        from audit.models import AuditLog
        summary = AuditLog.objects.filter(action="document.processed").latest("created_at").summary
        self.assertEqual(summary["fragments_merged"], 4)
        self.assertGreaterEqual(summary["titles_repaired"], 3)

    @override_settings(LOCALMIND={**settings.LOCALMIND, "OUTLINE_MERGE_SMALL": False})
    def test_switched_off_keeps_every_heading_as_its_own_module(self):
        doc_id = self.upload()
        self.assertEqual(Module.objects.filter(chapter__document_id=doc_id).count(), 7)
        # Titles are still repaired.
        self.assertTrue(Module.objects.filter(chapter__document_id=doc_id, title="QUESTIONS").exists())


class ExistingBookTests(TestCase):
    def setUp(self):
        self.faculty = make_faculty()
        self.student = make_student()
        self.subject = make_subject(code="OLD")
        assign(self.faculty, self.subject)
        enroll(self.student, self.subject)
        self.doc = make_published_document(self.subject, modules=(
            ("5.1 WHA 5.1 WHAT ARE LIFE PROCESSES? T ARE LIFE PROCESSES?", LONG),
            ("Q U E S T I O N S", "1. Why is diffusion insufficient? 2. What is alive?"),
            ("5.2.1 Autotrophic Nutrition", MID),
            ("Do You Know?", "Some plants like Cuscuta are parasites.")))
        self.chapter = Chapter.objects.get(document=self.doc)

    def test_dry_run_changes_nothing(self):
        before = list(Module.objects.values_list("title", "source_text"))
        report = tidy_existing_document(self.doc, dry_run=True)
        self.assertEqual(len(report["merged"]), 2)
        self.assertEqual(list(Module.objects.values_list("title", "source_text")), before)

    def test_merges_unreferenced_fragments_and_refreshes_their_lesson_and_quiz(self):
        from tutor.models import ModuleLesson
        from assessments.models import Assessment
        questions_box = Module.objects.get(title="Q U E S T I O N S")
        Assessment.objects.create(subject=self.subject, chapter=self.chapter, module=questions_box, kind="module", title="auto",
                                  auto_generated=True, questions=[])
        version = self.doc.content_version
        with self.captureOnCommitCallbacks(execute=True):
            report = tidy_existing_document(self.doc)
        self.assertEqual(len(report["merged"]), 2)
        titles = list(Module.objects.order_by("order").values_list("title", flat=True))
        self.assertEqual(titles, ["5.1 WHAT ARE LIFE PROCESSES?", "5.2.1 Autotrophic Nutrition"])
        self.assertFalse(Assessment.objects.filter(title="auto").exists())
        target = Module.objects.get(title="5.1 WHAT ARE LIFE PROCESSES?")
        self.assertIn("## QUESTIONS", target.source_text)
        self.doc.refresh_from_db()
        self.assertEqual(self.doc.content_version, version + 1)
        self.assertEqual(ModuleLesson.objects.get(module=target).status, "pending")

    def test_a_fragment_a_student_has_used_stays(self):
        box = Module.objects.get(title="Do You Know?")
        ModuleProgress.objects.create(student=self.student, module=box)
        report = tidy_existing_document(self.doc)
        self.assertTrue(Module.objects.filter(pk=box.pk).exists())
        self.assertIn("Do You Know?", report["kept_in_use"])
        self.assertEqual([m["title"] for m in report["merged"]], ["Q U E S T I O N S"])

    def test_command(self):
        out = StringIO()
        call_command("tidy_book", "--document", str(self.doc.id), "--dry-run", stdout=out)
        self.assertIn("merge: 'Q U E S T I O N S' into the end of", out.getvalue())
        self.assertEqual(Module.objects.count(), 4)
        call_command("tidy_book", "--document", str(self.doc.id), stdout=StringIO())
        self.assertEqual(Module.objects.count(), 2)
