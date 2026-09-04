import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { student } from "@/api/endpoints";
import { useAsync } from "@/hooks/useAsync";
import { CardGrid, Empty, ErrorBanner, H2, ListRow, Loading, Row, Screen, Stat, fmtSeconds, pct } from "@/ui";

export default function SubjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const docs = useAsync(() => student.documents(id), [id]);
  const an = useAsync(() => student.subjectAnalytics(id), [id]);
  return (
    <Screen refreshing={docs.loading} onRefresh={() => { docs.reload(); an.reload(); }}>
      {an.data ? (
        <>
          <H2>{an.data.subject.name}</H2>
          <Row>
            <Stat label="modules done" value={`${an.data.modules.filter((m: any) => m.status === "completed").length}/${an.data.modules.length}`} />
            <Stat label="quiz average" value={pct(an.data.quiz_average)} />
            <Stat label="reading time" value={fmtSeconds(an.data.time.learning_seconds)} />
          </Row>
        </>
      ) : null}
      <H2>Books</H2>
      <ErrorBanner message={docs.error} onRetry={docs.reload} />
      {docs.loading && !docs.data ? <Loading /> : null}
      {docs.data?.length === 0 ? <Empty text="No published books yet." /> : null}
      <CardGrid>
        {docs.data?.map((d) => (
          <ListRow key={d.id} icon="book-outline" title={d.title} subtitle={`${d.open_module_count} of ${d.module_count} modules open · ${d.completed_modules} completed · ${Math.round(d.progress_percent)}%`} onPress={() => router.push(`/student/document/${d.id}`)} />
        ))}
      </CardGrid>
    </Screen>
  );
}
