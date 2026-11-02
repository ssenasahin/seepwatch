import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { alertKeys, useApiKeys, type ApiKey } from "../../api/alerts";
import { ApiError, api } from "../../api/client";
import { Alert, CopyButton, EmptyState, SkeletonRows, TextField } from "../../components";
import { timeAgo } from "../../lib/format";
import "../pages.css";
import "./settings.css";
import "../alerts/alerts.css";

// Keys for scripts and other programs to read findings through the public API, which
// arrives with the scanners. Only a hash is kept, so a key is shown once.
export function ApiKeysPage() {
  const keys = useApiKeys();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api<{ key: ApiKey; secret: string }>("/api-keys", { method: "POST", body: { name } }),
    onSuccess: async ({ key, secret }) => {
      setSecret({ name: key.name, value: secret });
      setName("");
      await queryClient.invalidateQueries({ queryKey: alertKeys.apiKeys });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api-keys/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: alertKeys.apiKeys }),
  });
  const error = create.error instanceof ApiError ? create.error : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  const active = keys.data?.filter((k) => !k.revokedAt) ?? [];
  const revoked = keys.data?.filter((k) => k.revokedAt) ?? [];

  return (
    <>
      <header className="page-header">
        <div>
          <h1>API keys</h1>
          <p>
            Let a script or another program use <code className="mono">/api/watches</code>,{" "}
            <code className="mono">/api/findings</code> and{" "}
            <code className="mono">/api/incidents</code>: read what was found, add watches, and say
            a leak is being dealt with.
          </p>
        </div>
      </header>

      <div className="stack">
        {secret && (
          <section className="card card-body secret-once">
            <h2 className="security-title">Your new key, {secret.name}</h2>
            <p className="muted">
              Send it as <code className="mono">Authorization: Bearer &lt;key&gt;</code>. This is
              the only time it's shown; if you lose it, revoke it and make another.
            </p>
            <div className="secret-value">
              <code>{secret.value}</code>
              <CopyButton text={secret.value} />
            </div>
            <div>
              <button className="btn" onClick={() => setSecret(null)}>
                I've saved it
              </button>
            </div>
          </section>
        )}

        <section className="card">
          {keys.isPending && (
            <div className="card-body">
              <SkeletonRows rows={2} height={48} />
            </div>
          )}
          {keys.isError && (
            <div className="card-body">
              <Alert tone="error">Couldn't load your API keys.</Alert>
            </div>
          )}
          {keys.data && active.length === 0 && (
            <EmptyState icon={KeyRound} title="No API keys">
              A key acts as you, for watches, findings and incidents only: it can't change your
              password, team, alerts or keys.
            </EmptyState>
          )}
          {active.length > 0 && (
            <ul className="item-list">
              {active.map((k) => (
                <li key={k.id} className="item-row">
                  <span className="item-icon">
                    <KeyRound size={18} aria-hidden />
                  </span>
                  <div className="item-main">
                    <div className="item-title">{k.name}</div>
                    <div className="item-meta">
                      <span className="mono">{k.prefix}…</span> · made {timeAgo(k.createdAt)} ·{" "}
                      {k.lastUsedAt ? `last used ${timeAgo(k.lastUsedAt)}` : "never used"}
                    </div>
                  </div>
                  <div className="item-actions">
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        if (
                          confirm(`Revoke "${k.name}"? Anything using it stops working at once.`)
                        ) {
                          revoke.mutate(k.id);
                        }
                      }}
                    >
                      Revoke
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <form className="card-body inline-form" onSubmit={submit} noValidate>
            <div className="inline-form-row">
              <TextField
                label="New key"
                placeholder="Deploy script"
                value={name}
                onChange={(e) => setName(e.target.value)}
                hint="Name it after what will use it, so you know which to revoke."
                error={error ? (error.fieldError("name") ?? error.message) : undefined}
              />
              <button className="btn btn-primary" disabled={!name.trim() || create.isPending}>
                {create.isPending ? "Making…" : "Make key"}
              </button>
            </div>
          </form>
        </section>

        {revoked.length > 0 && (
          <p className="muted">
            Revoked: {revoked.map((k) => `${k.name} (${k.prefix}…)`).join(", ")}
          </p>
        )}
      </div>
    </>
  );
}
