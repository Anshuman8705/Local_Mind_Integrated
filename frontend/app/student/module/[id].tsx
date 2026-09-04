import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { AppState, Platform, ScrollView, Text, View } from "react-native";
import { student } from "@/api/endpoints";
import type { Message, TeachResponse } from "@/api/types";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, Chip, ErrorBanner, H1, H2, Input, Loading, Notice, P, Row, Screen, colors, pct, space } from "@/ui";

type Tab = "read" | "lesson" | "ask";

export default function ModuleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("read");
  const mod = useAsync(() => student.module(id), [id]);
  const quizzes = useAsync(() => student.quizzes({ module: id }), [id]);
  // The back arrow belongs to the book this module sits in. It cannot be set
  // in the layout because the book is only known once the module has loaded.
  const navigation = useNavigation();
  const documentId = mod.data?.document_id;
  useEffect(() => {
    navigation.setOptions({ backTo: documentId ? `/student/document/${documentId}` : "/student" });
  }, [navigation, documentId]);

  // Reading time: accumulate foreground seconds, flush every 60s and on unmount.
  const acc = useRef(0);
  useEffect(() => {
    let last = Date.now(); let active = true;
    const tick = setInterval(() => { if (active) { acc.current += (Date.now() - last) / 1000; } last = Date.now(); if (acc.current >= 60) flush(); }, 5000);
    const flush = () => { const s = Math.round(acc.current); if (s > 0) { acc.current = 0; student.reportTime(id, s).catch(() => {}); } };
    const sub = AppState.addEventListener("change", (st) => { active = st === "active"; last = Date.now(); if (!active) flush(); });
    return () => { clearInterval(tick); sub.remove(); flush(); };
  }, [id]);

  // Book and chapter often carry the same title, in which case printing both
  // reads as a stutter.
  const crumbs = [mod.data?.document_title, mod.data?.chapter_title].filter(Boolean);
  const trail = [...new Set(crumbs)].join(" · ");

  return (
    <Screen scroll={tab !== "ask"} padded={tab !== "ask"}>
      {mod.error ? <ErrorBanner message={mod.error} onRetry={mod.reload} /> : null}
      {mod.loading && !mod.data ? <Loading /> : null}
      {mod.data ? (
        <>
          <View style={{ padding: tab === "ask" ? space.lg : 0, paddingBottom: tab === "ask" ? 0 : undefined, gap: 8 }}>
            {trail ? <P muted small>{trail}</P> : null}
            <H1>{mod.data.title}</H1>
            <Row>
              <Chip label="Read" selected={tab === "read"} onPress={() => setTab("read")} />
              <Chip label="Lesson" selected={tab === "lesson"} onPress={() => setTab("lesson")} />
              <Chip label="Ask a doubt" selected={tab === "ask"} onPress={() => setTab("ask")} />
            </Row>
          </View>
          {/* Reading and the lesson keep a readable measure, and everything
              that used to sit underneath the text moves alongside it so a wide
              window is used rather than left blank. The aside wraps below on a
              narrow screen. */}
          {tab === "ask" ? <AskTab moduleId={id} /> : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.lg, alignItems: "flex-start" }}>
              <View style={{ flex: 1, minWidth: 320, maxWidth: 840, gap: space.md }}>
                {tab === "read" ? <Card><P>{mod.data.source_text}</P></Card> : <LessonTab moduleId={id} />}
              </View>
              <View style={{ width: 300, flexGrow: 1, minWidth: 260, maxWidth: 360, gap: space.md }}>
                <Card>
                  <H2 icon="stats-chart-outline">This module</H2>
                  <Row style={{ justifyContent: "space-between" }}>
                    <P muted small>Status</P>
                    <Badge value={mod.data.progress?.status ?? "not_started"} />
                  </Row>
                  {mod.data.progress?.best_quiz_percentage != null ? (
                    <Row style={{ justifyContent: "space-between" }}>
                      <P muted small>Best quiz</P>
                      <P small>{pct(mod.data.progress.best_quiz_percentage)}</P>
                    </Row>
                  ) : null}
                  {mod.data.start_page ? (
                    <Row style={{ justifyContent: "space-between" }}>
                      <P muted small>Pages</P>
                      <P small>{mod.data.start_page}{mod.data.end_page && mod.data.end_page !== mod.data.start_page ? `–${mod.data.end_page}` : ""}</P>
                    </Row>
                  ) : null}
                </Card>
                <Card>
                  <H2 icon="help-circle-outline">Quizzes</H2>
                  {quizzes.data?.length ? quizzes.data.map((qz) => (
                    <Card key={qz.id} onPress={() => router.push(`/student/quiz/${qz.id}`)} style={{ gap: 4 }}>
                      <Row style={{ justifyContent: "space-between" }}>
                        <P small style={{ flex: 1, fontWeight: "600" }}>{qz.title}</P>
                        <Badge value={qz.passed ? "passed" : qz.attempts_used ? "attempted" : "new"} color={qz.passed ? colors.success : colors.primary} />
                      </Row>
                      <P muted small>{qz.question_count} questions · pass {qz.pass_percentage}% · best {qz.best_percentage ?? "—"}{qz.best_percentage != null ? "%" : ""}</P>
                    </Card>
                  )) : <P muted small>No quiz has been set for this module yet.</P>}
                </Card>
              </View>
            </View>
          )}
        </>
      ) : null}
    </Screen>
  );
}

function LessonTab({ moduleId }: { moduleId: string }) {
  const q = useAsync(() => student.teach(moduleId), [moduleId]);
  const d: TeachResponse | null = q.data;
  return (
    <>
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.loading ? <Loading /> : null}
      {d ? (
        <>
          {d.generator === "fallback" ? <Notice tone="warning" message="The AI tutor is unavailable right now, so this lesson is a plain summary of the source text." /> : null}
          <Card>
            <H2>{d.lesson.title}</H2>
            <P muted small>Learning objectives</P>
            {d.lesson.learning_objectives.map((o, i) => <P key={i}>• {o}</P>)}
          </Card>
          {d.lesson.sections.map((s, i) => (
            <Card key={i}><H2>{s.heading}</H2><P>{s.explanation}</P>{s.source_reference ? <P muted small>Source: {s.source_reference}</P> : null}</Card>
          ))}
          {d.lesson.key_terms.length ? <Card><H2>Key terms</H2>{d.lesson.key_terms.map((t, i) => <P key={i}><Text style={{ fontWeight: "700" }}>{t.term}</Text> — {t.definition}</P>)}</Card> : null}
          <Card><H2>Summary</H2><P>{d.lesson.summary}</P></Card>
        </>
      ) : null}
    </>
  );
}

function AskTab({ moduleId }: { moduleId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [question, setQuestion] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [restoring, setRestoring] = useState(true);
  const scroll = useRef<ScrollView>(null);
  // Pick up where the student left off: the newest conversation on this
  // module is reloaded so earlier questions and answers stay on screen
  // instead of vanishing every time the tab is reopened.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const convs = await student.conversations(moduleId);
        const latest = convs[0];
        if (!latest || !alive) return;
        const full = await student.conversation(latest.id);
        if (!alive) return;
        setConversationId(full.id);
        setMessages(full.messages ?? []);
      } catch { /* a missing history is not an error worth showing */ }
      finally { if (alive) setRestoring(false); }
    })();
    return () => { alive = false; };
  }, [moduleId]);
  const ask = useAction(async (text: string) => {
    const mine: Message = { id: `local-${Date.now()}`, role: "user", content: text, grounded: true, source_reference: "", created_at: new Date().toISOString() };
    setMessages((m) => [...m, mine]); setQuestion(""); setSuggestions([]);
    const res = await student.ask(moduleId, text, conversationId);
    setConversationId(res.conversation_id); setMessages((m) => [...m, res.message]); setSuggestions(res.follow_up_suggestions ?? []);
  });
  const scrollToEnd = () => scroll.current?.scrollToEnd({ animated: true });
  useEffect(() => { const t = setTimeout(scrollToEnd, 60); return () => clearTimeout(t); }, [messages.length, ask.busy, suggestions.length]);
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <ScrollView
        ref={scroll}
        style={[{ flex: 1, minHeight: 0 }, Platform.OS === "web" && ({ overflowY: "auto" } as any)]}
        contentContainerStyle={{ padding: space.lg, gap: 10, width: "100%", maxWidth: 900, alignSelf: "center" }}
        showsVerticalScrollIndicator
        persistentScrollbar
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={scrollToEnd}
      >
        {restoring ? <Loading /> : null}
        {!restoring && messages.length === 0 ? <Notice message="Ask anything about this module. Answers are grounded in the module text and cite it." /> : null}
        {messages.map((m) => (
          <View key={m.id} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "80%", backgroundColor: m.role === "user" ? colors.primary : colors.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: m.role === "user" ? colors.primary : colors.border }}>
            <Text style={{ color: m.role === "user" ? colors.primaryText : colors.text, fontSize: 15, lineHeight: 21 }}>{m.content}</Text>
            {m.role === "assistant" && m.source_reference ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>Source: {m.source_reference}</Text> : null}
          </View>
        ))}
        {ask.busy ? <Loading /> : null}
        {ask.error ? <Notice tone="warning" message={ask.error} /> : null}
        {suggestions.length ? <Row>{suggestions.map((s) => <Chip key={s} label={s} onPress={() => ask.run(s)} />)}</Row> : null}
      </ScrollView>
      <View style={{ borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
        <View style={{ flexDirection: "row", gap: 8, padding: space.md, width: "100%", maxWidth: 900, alignSelf: "center" }}>
        <View style={{ flex: 1 }}><Input value={question} onChangeText={setQuestion} placeholder="Type your question" onSubmitEditing={() => question.trim() && ask.run(question.trim())} blurOnSubmit={false} editable={!ask.busy} /></View>
        <Button title="Ask" onPress={() => ask.run(question.trim())} disabled={!question.trim()} busy={ask.busy} />
        </View>
      </View>
    </View>
  );
}
