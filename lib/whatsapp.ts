export const BUSINESS_WHATSAPP_NUMBER = (process.env.NEXT_PUBLIC_WHATSAPP_BUSINESS_NUMBER || "923337109448").replace(/\D/g, "");

export const DEFAULT_WHATSAPP_INQUIRY_MESSAGE =
  "Hello {name},\n\nYour appointment at LAYLA ATELIER has been confirmed.\n\nService: {service}\nDate: {date}\nTime slot: {time}\n\nThank you for choosing LAYLA ATELIER. We look forward to welcoming you!";

type InquiryContext = {
  name: string;
  service: string;
  date: string;
  time: string;
};

export function renderWhatsAppInquiry(template: string, context: InquiryContext) {
  const replacements: Record<string, string> = {
    "{name}": context.name,
    "{date}": context.date,
    "{time}": context.time,
    "{service}": context.service,
  };

  return Object.entries(replacements).reduce(
    (text, [key, value]) => text.split(key).join(value),
    template,
  );
}

export function buildWhatsAppInquiryUrl(message: string) {
  const text = message.trim();
  return `https://wa.me/${BUSINESS_WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

export function buildWhatsAppClientUrl(phone: string, message: string) {
  let digits = phone
    .trim()
    .replace(/^00/, "")
    .replace(/\D/g, "");

  const defaultCountryCode = (
    process.env.NEXT_PUBLIC_WHATSAPP_DEFAULT_COUNTRY_CODE || "92"
  ).replace(/\D/g, "");

  // Example: 03337109448 -> 923337109448
  if (digits.startsWith("0")) {
    digits = `${defaultCountryCode}${digits.substring(1)}`;
  }

  if (!digits) return "";

  return `https://wa.me/${digits}?text=${encodeURIComponent(message.trim())}`;
}
