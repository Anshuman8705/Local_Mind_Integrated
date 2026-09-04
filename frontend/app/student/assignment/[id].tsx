import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { student } from "@/api/endpoints";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, ErrorBanner, H1, H2, Input, Loading, Notice, P, Screen, colors, fmtDate } from "@/ui";

export default function AssignmentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useAsync(async () => (await student.assignments()).find((a) => a.id === id) ?? null, [id]);
  const [content, setContent] = useState("");
  const started = useRef(Date.now());
  useEffect(() => { started.current = Date.now(); }, [id]);
  const submit = useAction(async () => {
    await student.submitAssignment(id, content.trim(), Math.round((Date.now() - started.current) / 1000));
    setContent(""); await q.reload();
  });
  const a = q.data; const sub = a?.my_submission;
  const canSubmit = a && a.status === "published" && (!sub || a.allow_resubmission) && (a.allow_late || !a.due_at || new Date(a.due_at) > new Date());
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.loading && !a ? <Loading /> : null}
      {a ? (
        <>
          <H1>{a.title}</H1>
          <P muted>{a.max_score} marks{a.due_at ? ` · due ${fmtDate(a.due_at)}` : ""}{a.allow_late ? "" : " · late submissions not accepted"}</P>
          {a.description ? <Card><P>{a.description}</P></Card> : null}
          {a.instructions ? <Card><H2>Instructions</H2><P>{a.instructions}</P></Card> : null}
          <Card><H2>Rubric</H2>{a.rubric.map((r, i) => <P key={i}>• {r.criterion} — {r.points} marks</P>)}</Card>
          {sub ? (
            <Card>
              <H2>Your submission</H2>
              <Badge value={sub.is_late ? `${sub.status} (late)` : sub.status} color={sub.status === "evaluated" ? colors.success : colors.primary} />
              <P muted small>Submitted {fmtDate(sub.submitted_at)}</P>
              <P>{sub.content}</P>
              {sub.status === "evaluated" ? <><H2>Score: {sub.score}/{a.max_score}</H2>{sub.feedback ? <P>{sub.feedback}</P> : null}</> : <Notice message="Awaiting evaluation by your faculty." />}
            </Card>
          ) : null}
          {canSubmit ? (
            <Card>
              <H2>{sub ? "Resubmit" : "Write your answer"}</H2>
              <Input multiline value={content} onChangeText={setContent} placeholder="Your answer" style={{ minHeight: 180 }} />
              <ErrorBanner message={submit.error} />
              <Button title="Submit" onPress={() => submit.run()} busy={submit.busy} disabled={!content.trim()} />
            </Card>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
