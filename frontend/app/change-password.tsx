import React, { useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { useAction } from "@/hooks/useAsync";
import { Button, Card, ErrorBanner, Input, Notice, P, Panel, Screen } from "@/ui";

export default function ChangePassword() {
  const { completePasswordChange, logout, mustChangePassword } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const action = useAction(async () => {
    if (next !== confirm) throw new Error("The two new passwords do not match.");
    await completePasswordChange(current, next);
  });
  return (
    <Screen>
      <Panel width={520}>
      {mustChangePassword ? <Notice tone="warning" message="Your account uses the initial password. Choose a new one before continuing." /> : null}
      <Card>
        <Input label="Current password" value={current} onChangeText={setCurrent} secureTextEntry />
        <Input label="New password" value={next} onChangeText={setNext} secureTextEntry />
        <Input label="Confirm new password" value={confirm} onChangeText={setConfirm} secureTextEntry />
        <P muted small>At least eight characters, not entirely numeric, not too similar to your email, and different from the current one.</P>
        <ErrorBanner message={action.error} />
        <Button title="Save New Password" onPress={() => action.run()} busy={action.busy} disabled={!current || !next || !confirm} />
        <Button title="Sign Out Instead" variant="ghost" onPress={() => logout()} />
      </Card>
      </Panel>
    </Screen>
  );
}
