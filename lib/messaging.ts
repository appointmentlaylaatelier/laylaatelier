import { once } from "node:events";
import net, { type Socket } from "node:net";
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

export const DEFAULT_CLIENT_MESSAGE01 = "Dear {name},\n\nWe are pleased to confirm your upcoming appointment at LAYLA ATELIER .\n\nService: {service}\nDate: {date}\nTime: {time}\n\nThank you for choosing LAYLA Atelier. We look forward to welcoming you.\n\nWarm regards,\nLAYLA ATELIER";
export const DEFAULT_EMAIL_SUBJECT01 = "Appointment Confirmation from LAYLA ATELIER";

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

type SmtpSocket = Socket | TLSSocket;

function createSmtpReader(socket: SmtpSocket) {
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

  const onData = (chunk: Buffer | string) => {
    buffer += chunk.toString();
    flush();
  };
  const onError = (error: Error) => {
    terminalError = error;
    flush();
  };
  const onTimeout = () => {
    terminalError = new Error("Gmail SMTP connection timed out.");
    socket.destroy(terminalError);
    flush();
  };

  socket.on("data", onData);
  socket.on("error", onError);
  socket.on("timeout", onTimeout);

  return {
    read: () => new Promise<SmtpResponse>((resolve, reject) => {
      if (terminalError) {
        reject(terminalError);
        return;
      }
      waiters.push({ resolve, reject });
      flush();
    }),
    dispose: () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
    },
  };
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function maskEmail(value: string) {
  const [local, domain] = value.split("@");
  if (!local || !domain) return value;
  return `${local.slice(0, 2)}***@${domain}`;
}

async function sendViaGmailSmtp(to: string, subject: string, message: string, attachment?: EmailAttachment) {
  const config = getEmailConfig();
  if (!config) throw new Error("Email is not configured. Add EMAIL_USER and EMAIL_APP_PASSWORD in .env.local.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error("Customer email address is invalid.");

  const smtpHost = "smtp.gmail.com";
  const smtpPort = 587;
  let stage = `opening TCP connection to ${smtpHost}:${smtpPort}`;
  let socket: SmtpSocket = net.createConnection({ host: smtpHost, port: smtpPort });
  socket.setTimeout(20_000);
  let reader = createSmtpReader(socket);

  try {
    await once(socket, "connect");

    stage = "reading Gmail SMTP greeting";
    ensureSmtpCode(await reader.read(), 220);

    const command = async (value: string, expected: number | number[], nextStage: string) => {
      stage = nextStage;
      socket.write(`${value}\r\n`);
      const response = await reader.read();
      ensureSmtpCode(response, expected);
      return response;
    };

    // Port 587 starts as a normal TCP SMTP connection and then upgrades to TLS.
    await command("EHLO layla-showroom-manager", 250, "sending EHLO before STARTTLS");
    await command("STARTTLS", 220, "requesting STARTTLS from Gmail");

    // Detach the plaintext SMTP reader before TLS takes ownership of the socket.
    reader.dispose();
    stage = "upgrading Gmail SMTP connection to TLS with STARTTLS";

    const tlsSocket = tls.connect({
      socket: socket as Socket,
      servername: smtpHost,
      rejectUnauthorized: true,
    });
    tlsSocket.setTimeout(20_000);
    socket = tlsSocket;
    reader = createSmtpReader(socket);
    await once(tlsSocket, "secureConnect");

    // RFC 3207 requires EHLO again after STARTTLS.
    await command("EHLO layla-showroom-manager", 250, "sending EHLO after STARTTLS");
    await command("AUTH LOGIN", 334, "starting Gmail authentication");
    await command(Buffer.from(config.user).toString("base64"), 334, "sending Gmail username");
    await command(Buffer.from(config.appPassword).toString("base64"), 235, "authenticating Gmail app password");
    await command(`MAIL FROM:<${config.user}>`, 250, "setting sender address");
    await command(`RCPT TO:<${to}>`, [250, 251], "setting recipient address");
    await command("DATA", 354, "starting message DATA");

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

    stage = "submitting message body to Gmail";
    socket.write(`${dotStuff(wireBody)}\r\n.\r\n`);
    ensureSmtpCode(await reader.read(), 250);
    stage = "completed";
    socket.write("QUIT\r\n");
  } catch (error) {
    const detail = errorMessage(error) || (error instanceof Error && error.cause ? errorMessage(error.cause) : "Unknown SMTP connection error");
    throw new Error(`Gmail SMTP failed while ${stage}: ${detail}`, { cause: error });
  } finally {
    reader.dispose();
    socket.end();
  }
}

async function sendEmail(email: string, subject: string, message: string, attachment?: EmailAttachment): Promise<ChannelResult> {
  if (!getEmailConfig()) {
    const error = "Email is not configured. Add EMAIL_USER and EMAIL_APP_PASSWORD in .env.local.";
    console.error("[email] Configuration missing", {
      hasEmailUser: Boolean(process.env.EMAIL_USER?.trim()),
      hasEmailAppPassword: Boolean(process.env.EMAIL_APP_PASSWORD?.trim()),
    });
    return { ok: false, skipped: true, error };
  }
  if (!email) {
    console.error("[email] Recipient address is missing");
    return { ok: false, error: "Email address is missing." };
  }

  const recipient = email.trim();
  console.info("[email] SMTP send starting", { to: maskEmail(recipient), subject, hasAttachment: Boolean(attachment) });

  try {
    await sendViaGmailSmtp(recipient, subject, message, attachment);
    console.info("[email] SMTP send succeeded", { to: maskEmail(recipient), subject });
    return { ok: true };
  } catch (error) {
    const message = errorMessage(error);
    console.error("[email] SMTP send failed", {
      to: maskEmail(recipient),
      subject,
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return { ok: false, error: message };
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
