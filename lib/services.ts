export const APPOINTMENT_TYPES = ["New Dress", "Fitting"] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

export const NEW_DRESS_SERVICES = [
  "Engagement Dress",
  "Wedding Gowns",
  "Evening Gowns",
  "Alteration",
] as const;

export const FITTING_SERVICES = [
  "1st Fitting (Wedding Gown)",
  "2nd Fitting (Wedding Gown)",
  "3rd Fitting (Wedding Gown)",
  "1st Fitting (Evening Gown)",
  "2nd Fitting (Evening Gown)",
  "3rd Fitting (Evening Gown)",
] as const;

// Kept for backward compatibility with appointments created before the split.
export const LEGACY_APPOINTMENT_SERVICES = [
  // Labels used by older versions of the application. Existing records keep
  // working, while all newly-booked appointments use the lists above.
  "Evening Gown",
  "Engagement",
  "Alterations",
  "Bridal Gowns",
  "1st Fitting",
  "2nd Fitting",
  "Final Fitting",
  "1st Fitting (Evening gown)",
  "2nd Fitting (Evening gown)",
  "Final Fitting (Evening gown)",
  "1st Fitting (Bridal gown)",
  "2nd Fitting (Bridal gown)",
  "Final Fitting (Bridal gown)",
] as const;

export const APPOINTMENT_SERVICES = [
  ...NEW_DRESS_SERVICES,
  ...FITTING_SERVICES,
  ...LEGACY_APPOINTMENT_SERVICES,
] as const;

export function inferAppointmentType(service: string, storedType?: unknown): AppointmentType {
  if (storedType === "Fitting" || storedType === "New Dress") return storedType;
  return /fitting/i.test(service) ? "Fitting" : "New Dress";
}

export function servicesForAppointmentType(type: AppointmentType): readonly string[] {
  return type === "New Dress" ? NEW_DRESS_SERVICES : FITTING_SERVICES;
}

export function isServiceCompatible(type: AppointmentType, service: string) {
  if (servicesForAppointmentType(type).includes(service as never)) return true;
  // Existing data can retain its historical service labels while being edited.
  return inferAppointmentType(service) === type && LEGACY_APPOINTMENT_SERVICES.includes(service as never);
}
