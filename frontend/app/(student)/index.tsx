import { useRouter } from "expo-router";
import React from "react";
import { student } from "@/api/endpoints";
import { useAuth } from "@/auth/AuthContext";
import { useAsync } from "@/hooks/useAsync";
import { Empty, ErrorBanner, ListRow, Loading, PageHeading, Screen } from "@/ui";

export default function Subjects() {
  const { user } = useAuth();
  const router = useRouter();
  const q = useAsync(() => student.subjects(), []);
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <PageHeading icon="hand-right-outline" title={`Hello, ${user?.full_name.split(" ")[0] ?? "there"}`} subtitle="Pick a subject to continue learning." />
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.loading && !q.data ? <Loading /> : null}
      {q.data?.length === 0 ? <Empty text="You are not enrolled in any subject yet." /> : null}
      {q.data?.map((s) => <ListRow key={s.id} icon="library-outline" title={s.name} subtitle={s.code} badge={s.status} onPress={() => router.push(`/(student)/subject/${s.id}`)} />)}
    </Screen>
  );
}
