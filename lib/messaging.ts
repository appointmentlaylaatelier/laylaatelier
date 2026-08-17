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

export const DEFAULT_CLIENT_MESSAGE01 = "Dear {name},\n\nWe are pleased to confirm your upcoming appointment at LAYLA ATELIER.\n\nService: {service}\nDate: {date}\nTime slot: {time}\n\nThank you for choosing LAYLA ATELIER. We look forward to welcoming you.\n\nWarm regards,\nLAYLA ATELIER";
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

type ResendConfig = {
  apiKey: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string;
};

type ResendErrorPayload = {
  message?: string;
  name?: string;
  statusCode?: number;
  error?: string;
};

export function renderClientMessage(value: string, context: ClientMessageContext) {
  const replacements: Record<string, string> = {
    "{name}": context.name,
    "{date}": context.date,
    "{time}": context.time,
    "{service}": context.service,
  };
  return Object.entries(replacements)
    .reduce((text, [key, replacement]) => text.split(key).join(replacement), value)
    .replace(/\batelier\b/gi, "ATELIER");
}

function getEmailConfig(): ResendConfig | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const fromEmail = process.env.RESEND_FROM_EMAIL?.trim();
  const fromName = process.env.RESEND_FROM_NAME?.trim() || process.env.EMAIL_FROM_NAME?.trim() || "LAYLA ATELIER";
  const replyTo = process.env.RESEND_REPLY_TO?.trim() || process.env.EMAIL_USER?.trim() || undefined;

  if (!apiKey || !fromEmail) return null;
  return { apiKey, fromName, fromEmail, replyTo };
}

function htmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function maskEmail(value: string) {
  const [local, domain] = value.split("@");
  if (!local || !domain) return value;
  return `${local.slice(0, 2)}***@${domain}`;
}

function stripDataUrl(value: string) {
  return value.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
}

function buildHtml(message: string, attachment?: EmailAttachment, contentId?: string) {
  const textHtml = htmlEscape(message).replace(/\r?\n/g, "<br>");
  const imageHtml = attachment && contentId && attachment.type.startsWith("image/")
    ? `<div style="margin-top:20px"><img src="cid:${contentId}" alt="${htmlEscape(attachment.name)}" style="display:block;max-width:100%;height:auto;border:0"></div>`
    : "";

  return `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#183442">${textHtml}${imageHtml}</div>`;
}

async function sendViaResend(to: string, subject: string, message: string, attachment?: EmailAttachment) {
  const config = getEmailConfig();
  if (!config) {
    throw new Error("Email is not configured on this server. Set RESEND_API_KEY and RESEND_FROM_EMAIL in the production environment.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    throw new Error("Customer email address is invalid.");
  }

  const contentId = attachment?.type.startsWith("image/") ? `layla-campaign-${Date.now()}` : undefined;
  const payload: Record<string, unknown> = {
    from: `${config.fromName} <${config.fromEmail}>`,
    to: [to],
    subject,
    text: message,
    html: buildHtml(message, attachment, contentId),
  };

  if (config.replyTo) payload.reply_to = config.replyTo;

  if (attachment) {
    const safeName = attachment.name.replace(/[\r\n"]/g, "_") || "attachment";
    payload.attachments = [
      {
        filename: safeName,
        content: stripDataUrl(attachment.data),
        content_type: attachment.type || "application/octet-stream",
        ...(contentId ? { content_id: contentId } : {}),
      },
    ];
  }

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "layla-showroom-manager/1.0",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new Error(`Resend API connection failed: ${errorMessage(error)}`, { cause: error });
  }

  let body: ResendErrorPayload & { id?: string } = {};
  try {
    body = await response.json() as ResendErrorPayload & { id?: string };
  } catch {
    // Keep an empty body; the HTTP status below still gives a useful error.
  }

  if (!response.ok) {
    const detail = body.message || body.error || body.name || response.statusText || "Unknown Resend error";
    throw new Error(`Resend API error ${response.status}: ${detail}`);
  }

  return body.id;
}

async function sendEmail(email: string, subject: string, message: string, attachment?: EmailAttachment): Promise<ChannelResult> {
  if (!getEmailConfig()) {
    const error = "Email is not configured on this server. Set RESEND_API_KEY and RESEND_FROM_EMAIL in the production environment.";
    console.error("[email] Resend configuration missing", {
      hasResendApiKey: Boolean(process.env.RESEND_API_KEY?.trim()),
      hasResendFromEmail: Boolean(process.env.RESEND_FROM_EMAIL?.trim()),
    });
    return { ok: false, skipped: true, error };
  }
  if (!email) {
    return { ok: false, skipped: true, error: "No customer email provided." };
  }

  const recipient = email.trim();
  console.info("[email] Resend send starting", { to: maskEmail(recipient), subject, hasAttachment: Boolean(attachment) });

  try {
    const id = await sendViaResend(recipient, subject, message, attachment);
    console.info("[email] Resend send succeeded", { to: maskEmail(recipient), subject, id });
    return { ok: true };
  } catch (error) {
    const message = errorMessage(error);
    console.error("[email] Resend send failed", {
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
