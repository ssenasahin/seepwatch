import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { adminKeys, usePlans, type Plan } from "../../api/admin";
import { ApiError, api } from "../../api/client";
import { Alert, SkeletonRows, TextField } from "../../components";
import "../pages.css";
import "./admin.css";

type Draft = Pick<Plan, "name" | "maxWatches" | "maxChannels" | "maxApiKeys">;

const BLANK: Draft = {
  name: "",
  maxWatches: 10,
  maxChannels: 20,
  maxApiKeys: 10,
};

const NUMBERS: { field: Exclude<keyof Draft, "name">; label: string; hint?: string }[] = [
  {
    field: "maxWatches",
    label: "Watches",
    hint: "Domains, addresses, organizations and key patterns.",
  },
  { field: "maxChannels", label: "Alert channels" },
  { field: "maxApiKeys", label: "API keys" },
];

// What each account may have. Every account without a plan of its own is on the
// default one. Lowering a limit takes nothing away; it only stops new additions.
export function PlansPage() {
  const plans = usePlans();

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Plans and limits</h1>
          <p>How many watches, channels and keys an account may have.</p>
        </div>
      </header>

      {plans.isPending && (
        <section className="card card-body">
          <SkeletonRows rows={3} height={64} />
        </section>
      )}
      {plans.isError && <Alert tone="error">Couldn't load plans.</Alert>}
      {plans.data && (
        <div className="stack">
          {plans.data.map((p) => (
            <PlanCard key={p.id} plan={p} />
          ))}
          <PlanCard />
        </div>
      )}
    </>
  );
}

// One plan's form; without a plan it makes a new one.
function PlanCard({ plan }: { plan?: Plan }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(plan ?? BLANK);
  const [saved, setSaved] = useState(false);

  const send = useMutation({
    mutationFn: (req: { path: string; method: string; body?: unknown }) =>
      api<{ plans: Plan[] }>(`/admin/plans${req.path}`, req),
    onSuccess: ({ plans }, req) => {
      queryClient.setQueryData(adminKeys.plans, plans);
      if (!plan) setDraft(BLANK);
      setSaved(req.method === "PATCH");
    },
    onMutate: () => setSaved(false),
  });
  const error = send.error instanceof ApiError ? send.error : null;

  const changed =
    !plan || (Object.keys(BLANK) as (keyof Draft)[]).some((k) => draft[k] !== plan[k]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send.mutate(
      plan
        ? { path: `/${plan.id}`, method: "PATCH", body: draft }
        : { path: "", method: "POST", body: draft },
    );
  };

  return (
    <form className="card card-body plan-card" onSubmit={submit} noValidate>
      <div className="plan-head">
        <h2 className="security-title">
          {plan ? plan.name : "New plan"}
          {plan?.isDefault && <span className="role-tag">Default</span>}
        </h2>
        {plan && (
          <span className="muted">
            {plan.users} {plan.users === 1 ? "account" : "accounts"}
          </span>
        )}
      </div>

      <div className="plan-fields">
        <TextField
          label="Name"
          value={draft.name}
          maxLength={50}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          error={error?.fieldError("name")}
        />
        {NUMBERS.map(({ field, label, hint }) => (
          <TextField
            key={field}
            label={label}
            type="number"
            inputMode="numeric"
            min={0}
            value={String(draft[field])}
            onChange={(e) => setDraft({ ...draft, [field]: e.target.valueAsNumber || 0 })}
            hint={hint}
            error={error?.fieldError(field)}
          />
        ))}
      </div>

      {error && !error.details && <Alert tone="error">{error.message}</Alert>}
      {saved && !changed && <Alert tone="success">Saved.</Alert>}

      <div className="row">
        <button className="btn btn-primary" disabled={!changed || send.isPending}>
          {plan ? "Save" : "Add plan"}
        </button>
        {plan && !plan.isDefault && (
          <>
            <button
              type="button"
              className="btn"
              disabled={send.isPending}
              onClick={() => send.mutate({ path: `/${plan.id}/default`, method: "POST" })}
            >
              Make default
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={send.isPending}
              onClick={() => {
                if (
                  confirm(
                    `Delete ${plan.name}? Its ${plan.users} accounts move to the default plan.`,
                  )
                ) {
                  send.mutate({ path: `/${plan.id}`, method: "DELETE" });
                }
              }}
            >
              Delete
            </button>
          </>
        )}
      </div>
    </form>
  );
}
