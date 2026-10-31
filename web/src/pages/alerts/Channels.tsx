import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BellRing,
  MessageSquare,
  Pencil,
  Plus,
  Send,
  Trash2,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { alertKeys, useChannels, type Channel, type ChannelType } from "../../api/alerts";
import { ApiError, api } from "../../api/client";
import { Alert, CopyButton, EmptyState, SkeletonRows, TextField } from "../../components";
import { timeAgo } from "../../lib/format";
import "../pages.css";
import "../settings/settings.css";
import "./alerts.css";

interface FieldSpec {
  name: string;
  label: string;
  placeholder: string;
  secret?: boolean;
}

const TYPES: Record<
  ChannelType,
  { label: string; icon: LucideIcon; fields: FieldSpec[]; help: string[] }
> = {
  SLACK: {
    label: "Slack",
    icon: MessageSquare,
    fields: [
      {
        name: "webhookUrl",
        label: "Incoming Webhook URL",
        placeholder: "https://hooks.slack.com/services/…",
        secret: true,
      },
    ],
    help: [
      "In Slack, open Apps and add Incoming Webhooks.",
      "Pick the channel alerts should go to.",
      "Copy the Webhook URL it gives you and paste it here.",
    ],
  },
  TELEGRAM: {
    label: "Telegram",
    icon: Send,
    fields: [
      { name: "botToken", label: "Bot token", placeholder: "123456789:AA…", secret: true },
      { name: "chatId", label: "Chat id", placeholder: "-1001234567890" },
    ],
    help: [
      "Talk to @BotFather, send /newbot and copy the token it gives you.",
      "Add the bot to your group, or send it a message yourself.",
      "Find the chat id with @userinfobot, or @channelname for a public channel.",
    ],
  },
  WEBHOOK: {
    label: "Webhook",
    icon: Webhook,
    fields: [{ name: "url", label: "URL", placeholder: "https://example.com/hooks/seepwatch" }],
    help: [
      "Seepwatch POSTs JSON to this URL when it finds a leak and as the incident moves on.",
      "Each request is signed: X-Seepwatch-Signature is sha256= and the HMAC-SHA256 of timestamp.body, with the timestamp in X-Seepwatch-Timestamp.",
      "A failed delivery is tried three times, waiting longer each time.",
    ],
  },
};

export function ChannelsPage() {
  const channels = useChannels();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  // A new webhook's signing secret, shown once.
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null);

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Channels</h1>
          <p>Where alerts go besides your inbox: Slack, Telegram, or your own webhook.</p>
        </div>
        {!adding && (
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus size={16} aria-hidden /> Add channel
          </button>
        )}
      </header>

      <div className="stack">
        {secret && (
          <section className="card card-body secret-once">
            <h2 className="security-title">Signing secret for {secret.name}</h2>
            <p className="muted">
              Your receiver checks each delivery's signature with this secret. This is the only time
              it's shown; if you lose it, delete the channel and add it again.
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

        {adding && (
          <ChannelForm
            onDone={(created) => {
              setAdding(false);
              if (created?.signingSecret) {
                setSecret({ name: created.channel.name, value: created.signingSecret });
              }
            }}
          />
        )}

        {channels.isPending && (
          <section className="card card-body">
            <SkeletonRows rows={3} height={48} />
          </section>
        )}
        {channels.isError && <Alert tone="error">Couldn't load your channels.</Alert>}

        {channels.data && (
          <section className="card">
            {channels.data.length === 0 ? (
              <EmptyState icon={BellRing} title="No channels yet">
                Alerts go to your email. Add Slack, Telegram or a webhook to reach your team where
                they already are.
              </EmptyState>
            ) : (
              <ul className="item-list">
                {channels.data.map((c) =>
                  editing === c.id ? (
                    <li key={c.id} className="card-body">
                      <ChannelForm existing={c} onDone={() => setEditing(null)} />
                    </li>
                  ) : (
                    <ChannelRow key={c.id} channel={c} onEdit={() => setEditing(c.id)} />
                  ),
                )}
              </ul>
            )}
          </section>
        )}
      </div>
    </>
  );
}

function ChannelRow({ channel: c, onEdit }: { channel: Channel; onEdit: () => void }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: alertKeys.channels });
  const { icon: Icon, label } = TYPES[c.type];

  const test = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; error: string | null }>(`/channels/${c.id}/test`, { method: "POST" }),
    onSettled: refresh,
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      api(`/channels/${c.id}`, { method: "PATCH", body: { enabled } }),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: () => api(`/channels/${c.id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  const target = c.settings.chatId ?? c.settings.url ?? null;

  return (
    <li className="item-row">
      <span className="item-icon">
        <Icon size={18} aria-hidden />
      </span>
      <div className="item-main">
        <div className="item-title">
          {c.name}
          {!c.enabled && <span className="badge badge-paused">Off</span>}
        </div>
        <div className="item-meta">
          <span>{label}</span>
          {target && <span className="mono">{target}</span>}
          <span>·</span>
          {c.lastSentAt ? (
            c.lastError ? (
              <span className="is-error">
                Last delivery failed {timeAgo(c.lastSentAt)}: {c.lastError}
              </span>
            ) : (
              <span>Last delivered {timeAgo(c.lastSentAt)}</span>
            )
          ) : (
            <span>Nothing sent yet</span>
          )}
        </div>
        {test.data && (
          <div className="item-meta" role="status">
            {test.data.ok ? "Test sent. Check that it arrived." : null}
          </div>
        )}
        {test.error && <div className="item-meta is-error">{test.error.message}</div>}
      </div>
      <div className="item-actions">
        <label className="switch" title="Off channels keep their settings but get no alerts">
          <input
            type="checkbox"
            checked={c.enabled}
            disabled={toggle.isPending}
            onChange={(e) => toggle.mutate(e.target.checked)}
          />
          On
        </label>
        <button className="btn btn-sm" onClick={() => test.mutate()} disabled={test.isPending}>
          {test.isPending ? "Sending…" : "Send test"}
        </button>
        <button
          className="btn btn-ghost btn-icon btn-sm"
          onClick={onEdit}
          aria-label={`Edit ${c.name}`}
        >
          <Pencil size={15} />
        </button>
        <button
          className="btn btn-ghost btn-icon btn-sm"
          onClick={() => {
            if (confirm(`Delete "${c.name}"? Escalation policies that use it will skip it.`)) {
              remove.mutate();
            }
          }}
          aria-label={`Delete ${c.name}`}
        >
          <Trash2 size={15} />
        </button>
      </div>
    </li>
  );
}

interface Created {
  channel: Channel;
  signingSecret?: string;
}

function ChannelForm({
  existing,
  onDone,
}: {
  existing?: Channel;
  onDone: (created?: Created) => void;
}) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<ChannelType>(existing?.type ?? "SLACK");
  const [name, setName] = useState(existing?.name ?? "");
  // Secret settings start blank when editing: blank keeps the stored value.
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(existing?.settings ?? {}).map(([k, v]) => [k, v ?? ""])),
  );
  const spec = TYPES[type];

  const save = useMutation({
    mutationFn: () => {
      const settings = Object.fromEntries(
        spec.fields.map((f) => [
          f.name,
          f.secret && existing && !values[f.name] ? null : (values[f.name] ?? ""),
        ]),
      );
      return existing
        ? api<Created>(`/channels/${existing.id}`, { method: "PATCH", body: { name, settings } })
        : api<Created>("/channels", { method: "POST", body: { type, name, settings } });
    },
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: alertKeys.channels });
      onDone(created);
    },
  });

  const error = save.error instanceof ApiError ? save.error : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form
      className={existing ? "inline-form" : "card card-body inline-form"}
      onSubmit={submit}
      noValidate
    >
      <h2 className="security-title">{existing ? `Edit ${existing.name}` : "Add a channel"}</h2>
      {error && !error.details && <Alert tone="error">{error.message}</Alert>}

      {!existing && (
        <div className="segmented" role="radiogroup" aria-label="Channel type">
          {(Object.keys(TYPES) as ChannelType[]).map((t) => {
            const { icon: Icon, label } = TYPES[t];
            return (
              <label key={t}>
                <input type="radio" name="type" checked={type === t} onChange={() => setType(t)} />
                <Icon size={15} aria-hidden /> {label}
              </label>
            );
          })}
        </div>
      )}

      <div className="help-text">
        <ol>
          {spec.help.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </div>

      <TextField
        label="Name"
        placeholder={type === "SLACK" ? "#alerts" : type === "TELEGRAM" ? "On-call chat" : "Pager"}
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={error?.fieldError("name")}
      />
      {spec.fields.map((f) => (
        <TextField
          key={`${type}-${f.name}`}
          label={f.label}
          placeholder={f.secret && existing ? "Saved. Leave blank to keep it" : f.placeholder}
          type={f.secret ? "password" : "text"}
          autoComplete="off"
          spellCheck={false}
          mono
          value={values[f.name] ?? ""}
          onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
          error={error?.fieldError(`settings.${f.name}`)}
        />
      ))}

      <div className="form-buttons">
        <button type="button" className="btn btn-ghost" onClick={() => onDone()}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? "Saving…" : existing ? "Save changes" : "Add channel"}
        </button>
      </div>
    </form>
  );
}
