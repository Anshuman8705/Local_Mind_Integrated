import { useRouter } from "expo-router";
import React, { useState } from "react";
import { manage } from "@/api/endpoints";
import { useAction } from "@/hooks/useAsync";
import { Button, Card, ErrorBanner, Input, Notice, P, Row, Screen } from "@/ui";
import { Target, TargetPicker } from "@/ui/TargetPicker";

export default function NewQuiz() {
  const router = useRouter();
  const [target, setTarget] = useState<Target>({});
  const [title, setTitle] = useState("");
  const [mcqs, setMcqs] = useState("5");
  const [subjective, setSubjective] = useState("1");
  const generate = useAction(async () => {
    const quiz = await manage.generateQuiz({ ...target, title: title || undefined, num_mcqs: Number(mcqs), num_subjective: Number(subjective) });
    router.replace(`/(manage)/quiz/${quiz.id}`);
  });
  const manual = useAction(async () => {
    const quiz = await manage.createQuiz({ ...target, title: title || "Untitled quiz", questions: [{ type: "mcq", question: "Replace this question", options: [{ key: "A", text: "Option A" }, { key: "B", text: "Option B" }, { key: "C", text: "Option C" }, { key: "D", text: "Option D" }], correct_answer: "A", explanation: "" }] });
    router.replace(`/(manage)/quiz/${quiz.id}`);
  });
  const ready = !!(target.module_id || target.chapter_id);
  return (
    <Screen>
      <Card>
        <TargetPicker value={target} onChange={setTarget} />
        <Input label="Title (optional)" value={title} onChangeText={setTitle} />
      </Card>
      <Card>
        <P>Generate from the source text</P>
        <Row><Input label="MCQs" value={mcqs} onChangeText={setMcqs} keyboardType="number-pad" style={{ width: 80 }} /><Input label="Written" value={subjective} onChangeText={setSubjective} keyboardType="number-pad" style={{ width: 80 }} /></Row>
        <Notice message="Questions are grounded in the selected module or chapter text. If the AI is unavailable you get a labelled placeholder draft to edit; it cannot be published as is." />
        <ErrorBanner message={generate.error} />
        <Button title="Generate draft" onPress={() => generate.run()} busy={generate.busy} disabled={!ready} />
      </Card>
      <Card>
        <P>Or start a blank quiz and write questions yourself.</P>
        <ErrorBanner message={manual.error} />
        <Button title="Create blank draft" variant="secondary" onPress={() => manual.run()} busy={manual.busy} disabled={!ready} />
      </Card>
    </Screen>
  );
}
