import { useId } from "react";

interface Props<T extends string> {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  small?: boolean;
}

// A few mutually exclusive choices, all visible: radio buttons dressed as tabs, so
// arrow keys and screen readers work as they would on any radio group.
export function Segmented<T extends string>({ label, options, value, onChange, small }: Props<T>) {
  const name = useId();
  return (
    <div
      className={`segmented${small ? " segmented-sm" : ""}`}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((o) => (
        <label key={o.value}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}
