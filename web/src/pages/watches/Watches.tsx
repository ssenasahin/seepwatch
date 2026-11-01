import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AtSign,
  FolderGit2,
  Globe,
  KeyRound,
  Plus,
  Radar,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { usePolicies } from "../../api/alerts";
import { ApiError, api } from "../../api/client";
import {
  isVerified,
  useWatches,
  watchKeys,
  type KeyCharset,
  type Watch,
  type WatchKind,
} from "../../api/watches";
import {
  Alert,
  CopyButton,
  EmptyState,
  SelectField,
  SkeletonRows,
  StatusBadge,
  TextField,
} from "../../components";
import { timeAgo } from "../../lib/format";
import "../pages.css";
import "../alerts/alerts.css";
import "./watches.css";

const KINDS: Record<
  WatchKind,
  { label: string; icon: LucideIcon; field: string; placeholder: string; hint: string }
> = {
  DOMAIN: {
    label: "Domain",
    icon: Globe,
    field: "Domain",
    placeholder: "example.com",
    hint: "Covers its subdomains too. You'll prove it's yours with a DNS record.",
  },
  EMAIL: {
    label: "Address",
    icon: AtSign,
    field: "Email address",
    placeholder: "ops@example.com",
    hint: "On one of your verified domains.",
  },
  GITHUB_ORG: {
    label: "GitHub organization",
    icon: FolderGit2,
    field: "Organization",
    placeholder: "acme",
    hint: "Its public repositories are scanned for your key patterns. You'll prove it's yours with a file.",
  },
  KEY_PATTERN: {
    label: "Key pattern",
    icon: KeyRound,
    field: "Prefix",
    placeholder: "acme_live_",
    hint: "What your own keys start with. Matched only inside your organizations' code and content that names your domains.",
  },
};

const CHARSETS: { value: KeyCharset; label: string }[] = [
  { value: "ALNUM", label: "Letters and digits" },
  { value: "HEX", label: "Hexadecimal" },
  { value: "BASE64URL", label: "Letters, digits, _ and -" },
];

export function WatchesPage() {
  const watches = useWatches();
  const [adding, setAdding] = useState(false);

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Watches</h1>
          <p>
            What Seepwatch looks for in public code and pastes. Domains and organizations are
            scanned once you've proven they're yours.
          </p>
        </div>
        {!adding && (
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus size={16} aria-hidden /> Add watch
          </button>
        )}
      </header>

      <div className="stack">
        {adding && <WatchForm onDone={() => setAdding(false)} />}

        {watches.isPending && (
          <section className="card card-body">
            <SkeletonRows rows={3} height={48} />
          </section>
        )}
        {watches.isError && <Alert tone="error">Couldn't load your watches.</Alert>}

        {watches.data && (
          <section className="card">
            {watches.data.length === 0 ? (
              <EmptyState icon={Radar} title="Nothing is being watched yet">
                Start with your domain. Once it's verified, add the addresses, organizations and key
                patterns that go with it.
              </EmptyState>
            ) : (
              <ul className="item-list">
                {watches.data.map((w) => (
                  <WatchRow key={w.id} watch={w} />
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </>
  );
}

function WatchState({ watch: w }: { watch: Watch }) {
  if (!w.enabled) return <StatusBadge status="paused" />;
  if (!isVerified(w)) return <StatusBadge status="pending" label="Not verified" />;
  return (
    <StatusBadge status="up" label={w.verification.method === "none" ? "Active" : "Verified"} />
  );
}

function describe(w: Watch): string {
  if (w.keyPattern) {
    const set = CHARSETS.find((c) => c.value === w.keyPattern!.charset)!.label.toLowerCase();
    const { minLength: min, maxLength: max } = w.keyPattern;
    return `then ${min === max ? min : `${min} to ${max}`} ${set}`;
  }
  if (w.verification.method === "domain" && w.verification.domain) {
    return `on ${w.verification.domain}`;
  }
  return "";
}

function WatchRow({ watch: w }: { watch: Watch }) {
  const queryClient = useQueryClient();
  const policies = usePolicies();
  const refresh = () => queryClient.invalidateQueries({ queryKey: watchKeys.all });
  const { icon: Icon, label: kindLabel } = KINDS[w.kind];
  const needsProof = w.verification.method === "dns" || w.verification.method === "github";

  const update = useMutation({
    mutationFn: (body: object) => api(`/watches/${w.id}`, { method: "PATCH", body }),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: () => api(`/watches/${w.id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  return (
    <li className="watch-item">
      <div className="item-row">
        <span className="item-icon">
          <Icon size={18} aria-hidden />
        </span>
        <div className="item-main">
          <div className="item-title">
            <span className={w.kind === "KEY_PATTERN" ? "mono" : undefined}>
              {w.label ?? w.value}
            </span>
            <WatchState watch={w} />
          </div>
          <div className="item-meta">
            <span>{kindLabel}</span>
            {w.label && <span className="mono">{w.value}</span>}
            {describe(w) && <span>{describe(w)}</span>}
          </div>
        </div>
        <div className="item-actions">
          <select
            className="input select select-sm"
            aria-label={`Escalation for ${w.value}`}
            value={w.escalationPolicy?.id ?? ""}
            disabled={update.isPending}
            onChange={(e) => update.mutate({ escalationPolicyId: e.target.value || null })}
          >
            <option value="">Everyone at once</option>
            {policies.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <label className="switch" title="A paused watch isn't scanned">
            <input
              type="checkbox"
              checked={w.enabled}
              disabled={update.isPending}
              onChange={(e) => update.mutate({ enabled: e.target.checked })}
            />
            On
          </label>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={() => {
              const extra = w.kind === "DOMAIN" ? " Addresses on it are removed too." : "";
              if (confirm(`Stop watching ${w.value}?${extra}`)) remove.mutate();
            }}
            aria-label={`Delete ${w.value}`}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      {needsProof && !isVerified(w) && <ProveIt watch={w} />}
    </li>
  );
}

// What to publish, where, and a button to look for it now.
function ProveIt({ watch: w }: { watch: Watch }) {
  const queryClient = useQueryClient();
  const check = useMutation({
    mutationFn: () =>
      api<{ verified: boolean; watch: Watch }>(`/watches/${w.id}/verify`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: watchKeys.all }),
  });
  const v = w.verification;
  if (v.method !== "dns" && v.method !== "github") return null;

  return (
    <div className="prove card-body">
      {v.method === "dns" ? (
        <>
          <p>
            Add this TXT record at your DNS provider, then check. It can take a few minutes to
            appear.
          </p>
          <dl className="prove-fields">
            <dt>Name</dt>
            <dd>
              <code>{v.record.name}</code>
              <CopyButton text={v.record.name} />
            </dd>
            <dt>Value</dt>
            <dd>
              <code>{v.record.value}</code>
              <CopyButton text={v.record.value} />
            </dd>
          </dl>
        </>
      ) : (
        <>
          <p>
            Create this file in the organization's <code>.github</code> repository, on its default
            branch. Only the organization's members can write there.
          </p>
          <dl className="prove-fields">
            <dt>File</dt>
            <dd>
              <code>
                {v.file.repository}/{v.file.path}
              </code>
            </dd>
            <dt>Content</dt>
            <dd>
              <code>{v.file.content}</code>
              <CopyButton text={v.file.content} />
            </dd>
          </dl>
        </>
      )}
      <div className="prove-check">
        <button className="btn btn-sm" onClick={() => check.mutate()} disabled={check.isPending}>
          {check.isPending ? "Checking…" : "Check now"}
        </button>
        {check.error && <span className="is-error">{check.error.message}</span>}
        {!check.isPending && v.lastVerifyError && v.lastVerifyAt && (
          <span className="is-error" role="status">
            {v.lastVerifyError} (checked {timeAgo(v.lastVerifyAt)})
          </span>
        )}
      </div>
    </div>
  );
}

function WatchForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<WatchKind>("DOMAIN");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [charset, setCharset] = useState<KeyCharset>("ALNUM");
  const [minLength, setMinLength] = useState("32");
  const [maxLength, setMaxLength] = useState("32");
  const spec = KINDS[kind];

  const save = useMutation({
    mutationFn: () =>
      api("/watches", {
        method: "POST",
        body: {
          kind,
          value,
          label: label || null,
          ...(kind === "KEY_PATTERN" && {
            keyPattern: { charset, minLength: Number(minLength), maxLength: Number(maxLength) },
          }),
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: watchKeys.all });
      onDone();
    },
  });

  const error = save.error instanceof ApiError ? save.error : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form className="card card-body inline-form" onSubmit={submit} noValidate>
      <h2 className="security-title">Add a watch</h2>
      {error && !error.details && <Alert tone="error">{error.message}</Alert>}

      <div className="segmented" role="radiogroup" aria-label="What to watch">
        {(Object.keys(KINDS) as WatchKind[]).map((k) => {
          const { icon: Icon, label: kindLabel } = KINDS[k];
          return (
            <label key={k}>
              <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />
              <Icon size={15} aria-hidden /> {kindLabel}
            </label>
          );
        })}
      </div>

      <div className="inline-form-row">
        <TextField
          label={spec.field}
          placeholder={spec.placeholder}
          hint={spec.hint}
          autoComplete="off"
          spellCheck={false}
          mono={kind === "KEY_PATTERN"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          error={error?.fieldError("value")}
        />
        <TextField
          label="Label (optional)"
          placeholder={kind === "KEY_PATTERN" ? "Production API keys" : "Main site"}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          error={error?.fieldError("label")}
        />
      </div>

      {kind === "KEY_PATTERN" && (
        <div className="inline-form-row">
          <SelectField
            label="After the prefix"
            value={charset}
            onChange={(e) => setCharset(e.target.value as KeyCharset)}
          >
            {CHARSETS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Shortest"
            type="number"
            min={8}
            max={128}
            value={minLength}
            onChange={(e) => setMinLength(e.target.value)}
            error={error?.fieldError("keyPattern.minLength")}
          />
          <TextField
            label="Longest"
            type="number"
            min={8}
            max={128}
            value={maxLength}
            onChange={(e) => setMaxLength(e.target.value)}
            error={error?.fieldError("keyPattern.maxLength")}
          />
        </div>
      )}

      <div className="form-buttons">
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? "Adding…" : "Add watch"}
        </button>
      </div>
    </form>
  );
}
