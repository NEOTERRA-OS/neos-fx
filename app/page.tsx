import { AppShell } from "../components/shell/AppShell";
import { AuthGate } from "../components/shell/AuthGate";

export default function Page() {
  return (
    <AuthGate>
      <AppShell />
    </AuthGate>
  );
}
