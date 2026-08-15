import tls, { type TLSSocket } from "node:tls";

export type DeliveryChannel = "email" | "whatsapp" | "both";

export type EmailAttachment = { name: string; type: string; data: string };

export type ClientMessageContext = {
  name: string;
  phone: string;
  email: string;
  service: string;
  date: string;
  time: string;
};

export const DEFAULT_CLIENT_MESSAGE01 = "Hello {name} from LAYLA Doha, your {service} appointment is scheduled for {date} at {time}.";
export const DEFAULT_EMAIL_SUBJECT01 = "Appointment Confirmation from LAYLA Atelier";

export const DEFAULT_CLIENT_MESSAGE02 = "May the blessings of Eid bring you joy, peace, and prosperity. Wishing you a wonderful celebration with your loved ones.";
export const DEFAULT_EMAIL_SUBJECT02 = "Eid Mubarak";

// Backward-compatible campaign aliases. New code should use the numbered
// constants explicitly so appointment (01) and campaign (02) messaging stay separate.
export const DEFAULT_CLIENT_MESSAGE = DEFAULT_CLIENT_MESSAGE02;
export const DEFAULT_EMAIL_SUBJECT = DEFAULT_EMAIL_SUBJECT02;

export type ChannelResult = {
  ok: boolean;
  skipped?: boolean;
  error?: string;
};

export type DeliveryResult = {
  email?: ChannelResult;
};

type SmtpResponse = {
  code: number;
  message: string;
};

export function renderClientMessage(value: string, context: ClientMessageContext) {
  const replacements: Record<string, string> = {
    "{name}": context.name,
    "{date}": context.date,
    "{time}": context.time,
    "{service}": context.service,
  };
  return Object.entries(replacements).reduce((text, [key, replacement]) => text.split(key).join(replacement), value);
}

function getEmailConfig() {
  const user = process.env.EMAIL_USER?.trim();
  const appPassword = process.env.EMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  const fromName = process.env.EMAIL_FROM_NAME?.trim() || "LAYLA Atelier";

  if (!user || !appPassword) return null;
  return { user, appPassword, fromName };
}

function createSmtpReader(socket: TLSSocket) {
  let buffer = "";
  let terminalError: Error | null = null;
  const waiters: Array<{ resolve: (value: SmtpResponse) => void; reject: (reason: Error) => void }> = [];

  function extractResponse(): SmtpResponse | null {
    const lines = buffer.split("\r\n");
    if (lines.length < 2) return null;

    const completeLines = lines.slice(0, -1);
    let finalIndex = -1;
    for (let index = 0; index < completeLines.length; index += 1) {
      if (/^\d{3} /.test(completeLines[index])) {
        finalIndex = index;
        break;
      }
    }
    if (finalIndex < 0) return null;

    const responseLines = completeLines.slice(0, finalIndex + 1);
    buffer = [...completeLines.slice(finalIndex + 1), lines.at(-1) || ""].join("\r\n");
    const code = Number(responseLines.at(-1)?.slice(0, 3));
    return { code, message: responseLines.join("\n") };
  }

  function flush() {
    while (waiters.length) {
      const response = extractResponse();
      if (!response) break;
      waiters.shift()?.resolve(response);
    }
    if (terminalError) {
      while (waiters.length) waiters.shift()?.reject(terminalError);
    }
  }

  socket.on("data", chunk => {
    buffer += chunk.toString("utf8");
    flush();
  });
  socket.on("error", error => {
    terminalError = error;
    flush();
  });
  socket.on("timeout", () => {
    terminalError = new Error("Gmail SMTP connection timed out.");
    socket.destroy(terminalError);
    flush();
  });

  return () => new Promise<SmtpResponse>((resolve, reject) => {
    if (terminalError) {
      reject(terminalError);
      return;
    }
    waiters.push({ resolve, reject });
    flush();
  });
}

function ensureSmtpCode(response: SmtpResponse, expected: number | number[]) {
  const accepted = Array.isArray(expected) ? expected : [expected];
  if (!accepted.includes(response.code)) {
    throw new Error(`Gmail SMTP error ${response.code}: ${response.message.replace(/\n/g, " ").slice(0, 240)}`);
  }
}

function encodeHeader(value: string) {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function encodeBody(value: string) {
  const encoded = Buffer.from(value.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64");
  return encoded.match(/.{1,76}/g)?.join("\r\n") || "";
}

function htmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dotStuff(value: string) {
  return value.replace(/(^|\r\n)\./g, "$1..");
}

async function sendViaGmailSmtp(to: string, subject: string, message: string, attachment?: EmailAttachment) {
  const config = getEmailConfig();
  if (!config) throw new Error("Email is not configured. Add EMAIL_USER and EMAIL_APP_PASSWORD in .env.local.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error("Customer email address is invalid.");

  const socket = tls.connect({ host: "smtp.gmail.com", port: 465, servername: "smtp.gmail.com", rejectUnauthorized: true });
  socket.setTimeout(20_000);
  const readResponse = createSmtpReader(socket);

  try {
    await new Promise<void>((resolve, reject) => {
      if (socket.authorized) { resolve(); return; }
      socket.once("secureConnect", resolve);
      socket.once("error", reject);
    });

    ensureSmtpCode(await readResponse(), 220);

    const command = async (value: string, expected: number | number[]) => {
      socket.write(`${value}\r\n`);
      const response = await readResponse();
      ensureSmtpCode(response, expected);
      return response;
    };

    await command("EHLO layla-showroom-manager", 250);
    await command("AUTH LOGIN", 334);
    await command(Buffer.from(config.user).toString("base64"), 334);
    await command(Buffer.from(config.appPassword).toString("base64"), 235);
    await command(`MAIL FROM:<${config.user}>`, 250);
    await command(`RCPT TO:<${to}>`, [250, 251]);
    await command("DATA", 354);

    const baseHeaders = [
      `From: ${encodeHeader(config.fromName)} <${config.user}>`,
      `To: <${to}>`,
      `Reply-To: <${config.user}>`,
      `Subject: ${encodeHeader(subject)}`,
      "MIME-Version: 1.0",
      `Date: ${new Date().toUTCString()}`,
    ];

    let wireBody: string;
    if (attachment) {
      const mixedBoundary = `layla-mixed-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const altBoundary = `layla-alt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const contentId = `layla-campaign-${Date.now()}@atelier.local`;
      const safeName = attachment.name.replace(/[\r\n"]/g, "_");
      const attachmentBody = attachment.data.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "").match(/.{1,76}/g)?.join("\r\n") || "";
      const htmlMessage = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#183442">${htmlEscape(message).replace(/\r?\n/g, "<br>")}<div style="margin-top:20px"><img src="cid:${contentId}" alt="${htmlEscape(safeName)}" style="display:block;max-width:100%;height:auto;border:0"></div></div>`;
      const headers = [...baseHeaders, `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`].join("\r\n");

      wireBody = [
        headers, "",
        `--${mixedBoundary}`,
        `Content-Type: multipart/alternative; boundary="${altBoundary}"`, "",
        `--${altBoundary}`,
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: base64", "", encodeBody(message),
        `--${altBoundary}`,
        "Content-Type: text/html; charset=UTF-8",
        "Content-Transfer-Encoding: base64", "", encodeBody(htmlMessage),
        `--${altBoundary}--`, "",
        `--${mixedBoundary}`,
        `Content-Type: ${attachment.type || "application/octet-stream"}; name="${safeName}"`,
        "Content-Transfer-Encoding: base64",
        `Content-ID: <${contentId}>`,
        `Content-Disposition: attachment; filename="${safeName}"`, "",
        attachmentBody,
        `--${mixedBoundary}--`, "",
      ].join("\r\n");
    } else {
      const headers = [...baseHeaders, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64"].join("\r\n");
      wireBody = `${headers}\r\n\r\n${encodeBody(message)}\r\n`;
    }

    socket.write(`${dotStuff(wireBody)}\r\n.\r\n`);
    ensureSmtpCode(await readResponse(), 250);
    socket.write("QUIT\r\n");
  } finally {
    socket.end();
  }
}

async function sendEmail(email: string, subject: string, message: string, attachment?: EmailAttachment): Promise<ChannelResult> {
  if (!getEmailConfig()) {
    return {
      ok: false,
      skipped: true,
      error: "Email is not configured. Add EMAIL_USER and EMAIL_APP_PASSWORD in .env.local.",
    };
  }
  if (!email) return { ok: false, error: "Email address is missing." };

  try {
    await sendViaGmailSmtp(email.trim(), subject, message, attachment);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Email delivery failed.",
    };
  }
}

export async function sendTransactionalEmail(email: string, subject: string, message: string) {
  return sendEmail(email, subject, message);
}

export async function sendClientMessage(
  context: ClientMessageContext,
  options: {
    channel: DeliveryChannel;
    messageTemplate?: string;
    emailMessageTemplate?: string;
    subjectTemplate?: string;
    attachment?: EmailAttachment;
  },
): Promise<DeliveryResult> {
  const sharedMessage = options.messageTemplate || DEFAULT_CLIENT_MESSAGE02;
  const emailMessage = renderClientMessage(options.emailMessageTemplate || sharedMessage, context);
  const subject = renderClientMessage(options.subjectTemplate || DEFAULT_EMAIL_SUBJECT02, context);
  return { email: await sendEmail(context.email, subject, emailMessage, options.attachment) };
}

export function deliverySummary(result: DeliveryResult) {
  const channels = Object.entries(result);
  return {
    attempted: channels.length,
    delivered: channels.filter(([, value]) => value?.ok).length,
    skipped: channels.filter(([, value]) => value?.skipped).length,
    failed: channels.filter(([, value]) => value && !value.ok && !value.skipped).length,
  };
}
