import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text } from "react-native";
import { student } from "@/api/endpoints";
import type { StartAttempt } from "@/api/types";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Button, Card, ErrorBanner, H1, Input, Loading, Notice, P, Screen, colors, confirmAsync } from "@/ui";

export default function QuizScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const info = useAsync(async () => (await student.quizzes()).find((q) => q.id === id) ?? null, [id]);
  const [attempt, setAttempt] = useState<StartAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [remaining, setRemaining] = useState<number | null>(null);
  const start = useAction(async () => { const a = await student.startAttempt(id); setAttempt(a); });
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const submit = useAction(async (force = false) => {
    if (!attempt) return;
    const current = answersRef.current;
    const unanswered = attempt.questions.filter((q) => !current[q.id]?.trim()).length;
    if (unanswered > 0 && !force) {
      const go = await confirmAsync("Unanswered questions", `${unanswered} question(s) are blank. Submit anyway?`, "Submit", "Keep working");
      if (!go) return;
    }
    const res = await student.submitAttempt(attempt.attempt_id, current);
    router.replace(`/(student)/attempt/${res.id}`);
  });
  const submitRef = useRef(submit.run);
  submitRef.current = submit.run;
  useEffect(() => {
    if (!attempt?.time_limit_minutes) return;
    const end = new Date(attempt.started_at).getTime() + attempt.time_limit_minutes * 60000;
    let fired = false;
    const tick = () => {
      const left = Math.max(0, Math.round((end - Date.now()) / 1000));
      setRemaining(left);
      // The server stops accepting the attempt at the limit; submit what the
      // student has rather than letting them keep typing into a dead attempt.
      if (left === 0 && !fired) { fired = true; void submitRef.current(true); }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [attempt]);

  if (!attempt) {
    return (
      <Screen>
        <ErrorBanner message={info.error} onRetry={info.reload} />
        {info.loading ? <Loading /> : null}
        {info.data ? (
          <Card>
            <H1>{info.data.title}</H1>
            {info.data.instructions ? <P>{info.data.instructions}</P> : null}
            <P muted>{info.data.question_count} questions · pass mark {info.data.pass_percentage}%{info.data.time_limit_minutes ? ` · ${info.data.time_limit_minutes} minutes` : ""}{info.data.max_attempts ? ` · ${info.data.attempts_used ?? 0} of ${info.data.max_attempts} attempts used` : ""}</P>
            {info.data.best_percentage != null ? <P muted>Your best so far: {Math.round(info.data.best_percentage)}%</P> : null}
            <ErrorBanner message={start.error} />
            <Button title="Start Quiz" onPress={() => start.run()} busy={start.busy} />
          </Card>
        ) : null}
      </Screen>
    );
  }
  return (
    <Screen>
      {attempt.resumed ? <Notice message="Resuming your open attempt." /> : null}
      {remaining !== null ? <Notice tone={remaining < 60 ? "warning" : "info"} message={`Time remaining: ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`} /> : null}
      {attempt.questions.map((q, i) => (
        <Card key={q.id}>
          <P><Text style={{ fontWeight: "700" }}>{i + 1}. </Text>{q.question}</P>
          {q.type === "mcq" ? q.options?.map((o) => {
            const sel = answers[q.id] === o.key;
            return (
              <Pressable key={o.key} onPress={() => setAnswers((a) => ({ ...a, [q.id]: o.key }))} style={{ flexDirection: "row", gap: 10, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.chipBg : colors.surface }}>
                <Text style={{ fontWeight: "700", color: colors.primary }}>{o.key}</Text><Text style={{ flex: 1, color: colors.text }}>{o.text}</Text>
              </Pressable>
            );
          }) : <Input multiline value={answers[q.id] ?? ""} onChangeText={(t) => setAnswers((a) => ({ ...a, [q.id]: t }))} placeholder="Write your answer" />}
        </Card>
      ))}
      <ErrorBanner message={submit.error} />
      <Button title="Submit Answers" onPress={() => submit.run()} busy={submit.busy} />
    </Screen>
  );
}
