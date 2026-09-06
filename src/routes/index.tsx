import { createFileRoute } from "@tanstack/react-router";
import { LatchDashboard } from "@/components/latch/dashboard";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <LatchDashboard />;
}
