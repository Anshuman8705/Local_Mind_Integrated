"""Lightweight, fully offline retrieval over a module's stored chunks.

BM25 in Python over the pre-tokenised term counts stored with each chunk.
A module has tens of chunks at most, so scoring them all is microseconds and
works identically on SQLite and PostgreSQL with no extension, no embedding
model and no network. (SQLite FTS5 was considered first; it is not available
on PostgreSQL and the gain over BM25 at this scale is nil.)

The tutor asks for the top ``k`` chunks for a question; neighbours of the
best hit are considered so an answer that continues across a chunk boundary
is not cut off, near-duplicate passages are dropped, and the chosen chunks
are returned in document order so the model reads them as the book flows.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass

from .chunking import ensure_chunks, tokenize

logger = logging.getLogger("localmind.retrieval")

BM25_K1 = 1.5
BM25_B = 0.75
# Two chunks whose term sets overlap this much are the same passage seen
# twice (the overlap tail, a repeated summary); keep the higher-scoring one.
NEAR_DUPLICATE_JACCARD = 0.8


@dataclass
class Hit:
    chunk: object
    score: float

    @property
    def text(self) -> str:
        return self.chunk.text


def _idf(term: str, docs_with_term: int, total: int) -> float:
    return math.log(1 + (total - docs_with_term + 0.5) / (docs_with_term + 0.5))


def score_chunks(query: str, chunks) -> list[Hit]:
    """BM25 scores for every chunk against the query; unsorted."""
    query_terms = tokenize(query)
    if not query_terms or not chunks:
        return []
    total = len(chunks)
    lengths = [max(1, sum(c.terms.values())) if c.terms else max(1, len(tokenize(c.text))) for c in chunks]
    avg_len = sum(lengths) / total
    df = {}
    for term in set(query_terms):
        df[term] = sum(1 for c in chunks if term in (c.terms or {}))
    hits = []
    for chunk, length in zip(chunks, lengths):
        terms = chunk.terms or {}
        score = 0.0
        for term in query_terms:
            tf = terms.get(term, 0)
            if not tf:
                continue
            idf = _idf(term, df[term], total)
            score += idf * (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * length / avg_len))
        hits.append(Hit(chunk=chunk, score=score))
    return hits


def _near_duplicate(a, b) -> bool:
    ta, tb = set((a.terms or {}).keys()), set((b.terms or {}).keys())
    if not ta or not tb:
        return False
    return len(ta & tb) / len(ta | tb) >= NEAR_DUPLICATE_JACCARD


def retrieve(module, question: str, k: int = 3, max_k: int | None = None, char_budget: int | None = None) -> list[Hit]:
    """Top ``k`` chunks for ``question`` from ``module``, in document order.

    When no chunk matches any query term (a greeting, a question in other
    words than the book uses), the first chunks of the module are returned so
    the model still answers from the module rather than from nothing.
    ``char_budget`` caps the total text so the prompt stays inside the mode's
    source budget whatever the chunk sizes are.
    """
    chunks = ensure_chunks(module)
    if not chunks:
        return []
    max_k = max_k or k
    hits = score_chunks(question, chunks)
    ranked = sorted((h for h in hits if h.score > 0), key=lambda h: h.score, reverse=True)
    if not ranked:
        chosen = [Hit(chunk=c, score=0.0) for c in chunks[:k]]
    else:
        chosen: list[Hit] = []
        for hit in ranked:
            if any(_near_duplicate(hit.chunk, c.chunk) for c in chosen):
                continue
            chosen.append(hit)
            if len(chosen) >= k:
                break
        # The chunk after the best hit often finishes the explanation the
        # best hit starts; take it when there is room.
        best = chosen[0].chunk
        by_order = {c.order: c for c in chunks}
        neighbour = by_order.get(best.order + 1)
        if neighbour and len(chosen) < max_k and all(c.chunk.pk != neighbour.pk for c in chosen):
            chosen.append(Hit(chunk=neighbour, score=0.0))
    chosen.sort(key=lambda h: h.chunk.order)
    if char_budget:
        kept, used = [], 0
        for hit in chosen:
            if kept and used + len(hit.text) > char_budget:
                break
            kept.append(hit)
            used += len(hit.text)
        chosen = kept
    return chosen


def coverage_sample(module, char_budget: int) -> tuple[str, int]:
    """Source text for tasks that want the *whole* module in compact form
    (quiz, lesson): chunks taken evenly across the module until the budget
    is spent, so questions cover the beginning, middle and end rather than
    only whatever fit in the first N characters. Returns (text, chunk_count)."""
    chunks = ensure_chunks(module)
    if not chunks:
        return "", 0
    total = sum(c.char_count for c in chunks)
    if total <= char_budget:
        return "\n\n".join(c.text for c in chunks), len(chunks)
    # Pick every n-th chunk, then trim the last one to fit.
    step = max(1, math.ceil(total / char_budget))
    picked = chunks[::step]
    parts, used = [], 0
    for chunk in picked:
        if used + chunk.char_count > char_budget:
            remaining = char_budget - used
            if remaining > 400:
                parts.append(chunk.text[:remaining].rsplit(". ", 1)[0] + ".")
            break
        parts.append(chunk.text)
        used += chunk.char_count
    return "\n\n".join(parts), len(parts)
