export const BUSINESS_WHATSAPP_NUMBER = (process.env.NEXT_PUBLIC_WHATSAPP_BUSINESS_NUMBER || "923337109448").replace(/\D/g, "");

export const DEFAULT_WHATSAPP_INQUIRY_MESSAGE =
  "Hello {name} from LAYLA, your appointment for {service} on {date} at {time} has been confirmed. Thank you for choosing our services!";

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
  let digits = phone.trim().replace(/^00/, "").replace(/\D/g, "");
  const defaultCountryCode = (process.env.NEXT_PUBLIC_WHATSAPP_DEFAULT_COUNTRY_CODE || "974").replace(/\D/g, "");
  if (digits && digits.length <= 8) digits = `${defaultCountryCode}${digits}`;
  if (!digits) return "";
  return `https://wa.me/${digits}?text=${encodeURIComponent(message.trim())}`;
}
