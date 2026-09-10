import React from "react";
import { Text } from "react-native";
import type { Lesson } from "@/api/types";
import { Card, H2, P } from "./index";

/** A structured lesson: objectives, sections, key terms, summary. Shared by the
 * student Lesson tab and the faculty preview so both show the same thing. */
export function LessonView({ lesson }: { lesson: Lesson }) {
  return (
    <>
      <Card>
        <H2>{lesson.title}</H2>
        <P muted small>Learning objectives</P>
        {lesson.learning_objectives.map((o, i) => <P key={i}>• {o}</P>)}
      </Card>
      {lesson.sections.map((s, i) => (
        <Card key={i}><H2>{s.heading}</H2><P>{s.explanation}</P>{s.source_reference ? <P muted small>Source: {s.source_reference}</P> : null}</Card>
      ))}
      {lesson.key_terms.length ? (
        <Card><H2>Key terms</H2>{lesson.key_terms.map((t, i) => <P key={i}><Text style={{ fontWeight: "700" }}>{t.term}</Text> — {t.definition}</P>)}</Card>
      ) : null}
      <Card><H2>Summary</H2><P>{lesson.summary}</P></Card>
    </>
  );
}
