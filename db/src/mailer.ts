import nodemailer from "nodemailer";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

// Code that sends mail depends on this interface, not on SMTP, so tests can capture it.
export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
}

export function smtpMailer(config: SmtpConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    // Port 465 speaks TLS from the first byte; others upgrade with STARTTLS.
    secure: config.port === 465,
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
  });
  return {
    async send(mail) {
      await transport.sendMail({ from: config.from, ...mail });
    },
  };
}

// A plain, branded wrapper shared by every transactional email.
export function emailLayout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#0b0d10;font-family:Inter,Segoe UI,system-ui,sans-serif;color:#e8eaed">
    <div style="max-width:520px;margin:0 auto;padding:40px 24px">
      <p style="margin:0 0 32px;font-weight:600;font-size:18px;letter-spacing:-0.02em">Seepwatch</p>
      <h1 style="margin:0 0 16px;font-size:22px;letter-spacing:-0.02em">${title}</h1>
      ${body}
      <p style="margin:40px 0 0;font-size:12px;color:#8b939d">Leak and secret scanning for the code you didn&#39;t mean to publish.</p>
    </div>
  </body>
</html>`;
}

// Anything interpolated into an email's HTML goes through this, even values that
// were validated elsewhere: validation rules change, escaping stays correct.
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
