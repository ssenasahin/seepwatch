import { CircleAlert, CircleCheck, Info, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type Tone = "error" | "success" | "info";

const ICONS: Record<Tone, LucideIcon> = { error: CircleAlert, success: CircleCheck, info: Info };

export function Alert({ tone, children }: { tone: Tone; children: ReactNode }) {
  const Icon = ICONS[tone];
  return (
    // Errors interrupt a screen reader; success and info wait their turn.
    <div className={`alert alert-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon size={16} aria-hidden />
      <div>{children}</div>
    </div>
  );
}
