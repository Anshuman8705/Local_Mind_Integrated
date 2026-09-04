import { useRouter } from "expo-router";
import React from "react";
import { manage } from "@/api/endpoints";
import { useAsync } from "@/hooks/useAsync";
import { CardGrid, Empty, ErrorBanner, ListRow, Loading, P, Screen } from "@/ui";

export default function Subjects() {
  const router = useRouter();
  const q = useAsync(() => manage.subjects(), []);
  const ov = useAsync(() => manage.overview(), []);
  const byId = new Map<string, any>((ov.data?.subjects ?? []).map((s: any) => [s.subject.id, s]));
  return (
    <Screen refreshing={q.loading} onRefresh={() => { q.reload(); ov.reload(); }}>
      <P muted>Subjects you manage. Open one for students, analytics and content.</P>
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.loading && !q.data ? <Loading /> : null}
      {q.data?.length === 0 ? <Empty text="No subjects assigned to you yet." /> : null}
      <CardGrid>
        {q.data?.map((s) => {
          const a = byId.get(s.id);
          return <ListRow key={s.id} icon="library-outline" title={`${s.code} · ${s.name}`} subtitle={`${s.active_students} students${a ? ` · ${a.documents.published} published books · ${a.quizzes.published} quizzes · ${a.assignments.awaiting_evaluation} to evaluate` : ""}`} badge={s.status === "active" ? undefined : s.status} onPress={() => router.push(`/manage/subject/${s.id}`)} />;
        })}
      </CardGrid>
    </Screen>
  );
}
