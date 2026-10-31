import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, children, action }: Props) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={20} aria-hidden />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}
