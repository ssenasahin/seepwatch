import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ListOrdered, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import {
  alertKeys,
  useChannels,
  usePolicies,
  useTeam,
  type Channel,
  type EscalationPolicy,
  type EscalationStep,
  type EscalationTarget,
  type TeamMember,
} from "../../api/alerts";
import { ApiError, api } from "../../api/client";
import { Alert, EmptyState, SkeletonRows, TextField } from "../../components";
import "../pages.css";
import "../settings/settings.css";
import "./alerts.css";
import "./escalation.css";

const MAX_STEPS = 5;

const keyOf = (t: EscalationTarget) => (t.kind === "member" ? `u:${t.userId}` : `c:${t.channelId}`);

export function EscalationPage() {
  const policies = usePolicies();
  const team = useTeam();
  const channels = useChannels();
  const [editing, setEditing] = useState<string | "new" | null>(null);

  const ready = team.data && channels.data;
  const names = new Map<string, string>([
    ...(team.data?.members ?? []).map((m): [string, string] => [`u:${m.userId}`, m.email]),
    ...(channels.data ?? []).map((c): [string, string] => [`c:${c.id}`, c.name]),
  ]);

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Escalation</h1>
          <p>Who hears first when a leak is found, and who next if nobody takes it on in time.</p>
        </div>
        {editing === null && (
          <button className="btn btn-primary" onClick={() => setEditing("new")}>
            <Plus size={16} aria-hidden /> New policy
          </button>
        )}
      </header>

      <div className="stack">
        {editing === "new" && ready && (
          <PolicyEditor
            members={team.data.members}
            channels={channels.data}
            onDone={() => setEditing(null)}
          />
        )}

        {(policies.isPending || !ready) && !policies.isError && (
          <section className="card card-body">
            <SkeletonRows rows={2} height={64} />
          </section>
        )}
        {policies.isError && <Alert tone="error">Couldn't load your escalation policies.</Alert>}

        {policies.data && ready && policies.data.length === 0 && editing !== "new" && (
          <section className="card">
            <EmptyState icon={ListOrdered} title="No escalation policies">
              Without one, a leak alerts you and every channel at once. A policy alerts one step at
              a time and moves on when nobody takes it on.
            </EmptyState>
          </section>
        )}

        {policies.data &&
          ready &&
          policies.data.map((p) =>
            editing === p.id ? (
              <PolicyEditor
                key={p.id}
                existing={p}
                members={team.data.members}
                channels={channels.data}
                onDone={() => setEditing(null)}
              />
            ) : (
              <PolicyCard key={p.id} policy={p} names={names} onEdit={() => setEditing(p.id)} />
            ),
          )}
      </div>
    </>
  );
}

function PolicyCard({
  policy,
  names,
  onEdit,
}: {
  policy: EscalationPolicy;
  names: Map<string, string>;
  onEdit: () => void;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api(`/escalation-policies/${policy.id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: alertKeys.policies }),
  });

  return (
    <section className="card">
      <div className="card-body card-head">
        <div>
          <h2 className="security-title">{policy.name}</h2>
          <p className="muted">
            {policy.steps.length === 1 ? "1 step" : `${policy.steps.length} steps`}
          </p>
        </div>
        <div className="item-actions">
          <button className="btn btn-sm" onClick={onEdit}>
            <Pencil size={14} aria-hidden /> Edit
          </button>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            aria-label={`Delete ${policy.name}`}
            onClick={() => {
              if (
                confirm(
                  `Delete "${policy.name}"? Leaks it covered will alert you and every channel instead.`,
                )
              ) {
                remove.mutate();
              }
            }}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <ol className="steps card-body">
        {policy.steps.map((step, i) => (
          <li key={i} className="step">
            <span className="step-when">
              {i === 0 ? "At once" : `After ${step.waitMinutes} min unacknowledged`}
            </span>
            <span className="step-who">
              {step.targets.length === 0
                ? "Nobody: everyone on this step has left"
                : step.targets.map((t) => names.get(keyOf(t)) ?? "a removed channel").join(", ")}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PolicyEditor({
  existing,
  members,
  channels,
  onDone,
}: {
  existing?: EscalationPolicy;
  members: TeamMember[];
  channels: Channel[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(existing?.name ?? "");
  const [steps, setSteps] = useState<EscalationStep[]>(
    existing?.steps ?? [{ waitMinutes: 0, targets: [] }],
  );

  const save = useMutation({
    mutationFn: () =>
      existing
        ? api(`/escalation-policies/${existing.id}`, { method: "PUT", body: { name, steps } })
        : api("/escalation-policies", { method: "POST", body: { name, steps } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: alertKeys.policies });
      onDone();
    },
  });
  const error = save.error instanceof ApiError ? save.error : null;

  const update = (i: number, step: EscalationStep) =>
    setSteps(steps.map((s, j) => (j === i ? step : s)));
  const toggle = (i: number, target: EscalationTarget) => {
    const step = steps[i]!;
    const has = step.targets.some((t) => keyOf(t) === keyOf(target));
    update(i, {
      ...step,
      targets: has
        ? step.targets.filter((t) => keyOf(t) !== keyOf(target))
        : [...step.targets, target],
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form className="card card-body inline-form" onSubmit={submit} noValidate>
      <h2 className="security-title">
        {existing ? `Edit ${existing.name}` : "New escalation policy"}
      </h2>
      {error && (!error.details || error.fieldError("steps")) && (
        <Alert tone="error">{error.fieldError("steps") ?? error.message}</Alert>
      )}
      <TextField
        label="Name"
        placeholder="Shop on-call"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={error?.fieldError("name")}
      />

      {members.length === 1 && (
        <Alert tone="info">
          It's just you on your team. <Link to="/team">Invite people</Link> so a later step can
          reach someone else.
        </Alert>
      )}

      <ol className="step-editor">
        {steps.map((step, i) => (
          <li key={i}>
            {i > 0 && <ArrowDown size={16} className="step-arrow" aria-hidden />}
            <fieldset className="step-card">
              <legend className="step-legend">Step {i + 1}</legend>
              {i === 0 ? (
                <p className="help-text">Alerted as soon as a leak is found.</p>
              ) : (
                <div className="step-wait">
                  <TextField
                    label="If nobody acknowledges within (minutes)"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={1440}
                    value={String(step.waitMinutes)}
                    onChange={(e) => update(i, { ...step, waitMinutes: Number(e.target.value) })}
                    error={error?.fieldError(`steps.${i}.waitMinutes`)}
                  />
                </div>
              )}
              <div className="step-targets" role="group" aria-label={`Who step ${i + 1} alerts`}>
                {members.map((m) => (
                  <label key={m.userId} className="switch">
                    <input
                      type="checkbox"
                      checked={step.targets.some((t) => keyOf(t) === `u:${m.userId}`)}
                      onChange={() => toggle(i, { kind: "member", userId: m.userId })}
                    />
                    {m.email}
                  </label>
                ))}
                {channels.map((c) => (
                  <label key={c.id} className="switch">
                    <input
                      type="checkbox"
                      checked={step.targets.some((t) => keyOf(t) === `c:${c.id}`)}
                      onChange={() => toggle(i, { kind: "channel", channelId: c.id })}
                    />
                    {c.name} <span className="faint">({c.type.toLowerCase()})</span>
                  </label>
                ))}
              </div>
              {error?.fieldError(`steps.${i}.targets`) && (
                <span className="field-error">{error.fieldError(`steps.${i}.targets`)}</span>
              )}
              {i > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm step-remove"
                  onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                >
                  <Trash2 size={14} aria-hidden /> Remove step
                </button>
              )}
            </fieldset>
          </li>
        ))}
      </ol>

      {steps.length < MAX_STEPS && (
        <div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setSteps([...steps, { waitMinutes: 15, targets: [] }])}
          >
            <Plus size={14} aria-hidden /> Add a step
          </button>
        </div>
      )}

      <div className="form-buttons">
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? "Saving…" : existing ? "Save changes" : "Create policy"}
        </button>
      </div>
    </form>
  );
}
