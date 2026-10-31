interface Props {
  width?: number | string;
  height?: number | string;
}

export function Skeleton({ width = "100%", height = 14 }: Props) {
  return <span className="skeleton" style={{ width, height }} aria-hidden />;
}

// A stack of placeholder rows, shaped like the table or list that is loading.
export function SkeletonRows({ rows = 4, height = 40 }: { rows?: number; height?: number }) {
  return (
    <div style={{ display: "grid", gap: 8 }} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} />
      ))}
    </div>
  );
}
