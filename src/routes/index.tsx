import { createFileRoute } from "@tanstack/react-router";
import { LatchDashboard } from "@/components/latch/dashboard";

export const Route = createFileRoute("/")({
  ssr: false,
  component: Home,
});

function Home() {
  return <LatchDashboard />;
}
