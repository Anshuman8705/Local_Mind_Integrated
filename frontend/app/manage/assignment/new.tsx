import { useRouter } from "expo-router";
import React, { useState } from "react";
import { manage } from "@/api/endpoints";
import { useAction } from "@/hooks/useAsync";
import { Button, Card, ErrorBanner, Input, Notice, P, Screen } from "@/ui";
import { Target, TargetPicker } from "@/ui/TargetPicker";

export default function NewAssignment() {
  const router = useRouter();
  const [target, setTarget] = useState<Target>({});
  const [title, setTitle] = useState("");
  const [maxScore, setMaxScore] = useState("10");
  const generate = useAction(async () => { const a = await manage.generateAssignment({ ...target, title: title || undefined, max_score: Number(maxScore) }); router.replace(`/manage/assignment/${a.id}`); });
  const blank = useAction(async () => {
    const a = await manage.createAssignment({ ...target, title: title || "Untitled assignment", max_score: Number(maxScore), rubric: [{ criterion: "Accuracy", points: Math.ceil(Number(maxScore) / 2) }, { criterion: "Clarity", points: Math.floor(Number(maxScore) / 2) }] });
    router.replace(`/manage/assignment/${a.id}`);
  });
  const ready = !!(target.module_id || target.chapter_id || target.subject_id);
  return (
    <Screen>
      <Card>
        <TargetPicker value={target} onChange={setTarget} allowSubject />
        <Input label="Title (optional)" value={title} onChangeText={setTitle} />
        <Input label="Maximum score" value={maxScore} onChangeText={setMaxScore} keyboardType="number-pad" style={{ width: 120 }} />
      </Card>
      <Card>
        <Notice message="Generated assignments draft a description, instructions and rubric from the source text. You review and edit before publishing." />
        <ErrorBanner message={generate.error ?? blank.error} />
        <Button title="Generate Draft" onPress={() => generate.run()} busy={generate.busy} disabled={!ready} />
        <P muted small>Generation needs a module or chapter; a subject-level assignment starts blank.</P>
        <Button title="Create Blank Draft" variant="secondary" onPress={() => blank.run()} busy={blank.busy} disabled={!ready} />
      </Card>
    </Screen>
  );
}
