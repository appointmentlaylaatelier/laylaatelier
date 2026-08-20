"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { APPOINTMENT_SERVICES } from "@/lib/services";
import { DEFAULT_WHATSAPP_INQUIRY_MESSAGE } from "@/lib/whatsapp";
import { formatTime12, formatTimeRange12, minutesToTimeValue, timeToMinutes } from "@/lib/time";

type Role = "receptionist" | "manager";
type Status = "Confirmed" | "Canceled" | "Arrived" | "No show" | "Walk-in";
type PlacementStatus = "Placed" | "Not placed" | "Follow-up";
type Period = "All" | "Daily" | "Weekly" | "Monthly" | "Yearly" | "Custom";
type SessionUser = { id: string; name: string; email: string; role: Role };
type Appointment = {
  id: string; client: string; phone: string; email: string; service: string;
  date: string; start: string; end: string; status: Status; called: boolean; notes?: string; designerAssigned?: string; placementStatus: PlacementStatus;
};
type BookingPayload = Omit<Appointment, "id" | "status" | "called"> & {
  whatsappMessage: string;
  emailSubject: string;
  emailMessage: string;
};
type Blacklisted = { id: string; name: string; phone: string; reason: string; date: string };
type DateRange = { period: Period; from: string; to: string };

const services = APPOINTMENT_SERVICES;
const statusOptions: Status[] = ["Confirmed", "Canceled", "Arrived", "No show", "Walk-in"];
const placementOptions: PlacementStatus[] = ["Not placed", "Placed", "Follow-up"];
const APPOINTMENT_SLOT_MINUTES = 30;
const DEFAULT_CLIENT_MESSAGE01 = "Dear {name},\n\nWe are pleased to confirm your upcoming appointment at LAYLA ATELIER.\n\nService: {service}\nDate: {date}\nTime slot: {time}\n\nThank you for choosing LAYLA ATELIER. We look forward to welcoming you.\n\nWarm regards,\nLAYLA ATELIER";
const DEFAULT_EMAIL_SUBJECT01 = "Appointment Confirmation from LAYLA ATELIER";
const DEFAULT_CLIENT_MESSAGE02 = "May the blessings of Eid bring you joy, peace, and prosperity. Wishing you a wonderful celebration with your loved ones.";
const DEFAULT_EMAIL_SUBJECT02 = "Eid Mubarak";
type MessageAudience = "all" | "week" | "month" | "year" | "custom";
type MessageChannel = "email";
type EmailAttachment = { name: string; type: string; data: string };

function isoDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function dateFromIso(value: string) { return new Date(`${value}T12:00:00`); }
function normalizePhone(value: string) { return value.replace(/\D/g, "").replace(/^974/, ""); }
function initials(name: string) { return name.split(" ").filter(Boolean).map(x => x[0]).slice(0, 2).join("").toUpperCase(); }
function uniqueClientCount(items: Appointment[]) { return new Set(items.map(a => (a.email || normalizePhone(a.phone)).toLowerCase())).size; }
function inRange(date: string, from: string, to: string) { return date >= from && date <= to; }
function allClientsRange(items: Appointment[]): DateRange {
  const today = isoDate();
  const historicalDates = items.map(a => a.date).filter(date => date <= today).sort();
  return { period: "All", from: historicalDates[0] || today, to: today };
}

function rangeForPreset(period: Exclude<Period, "Custom" | "All">, anchor = new Date()): DateRange {
  const start = new Date(anchor); const end = new Date(anchor);
  if (period === "Weekly") {
    const day = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - day);
    end.setTime(start.getTime()); end.setDate(start.getDate() + 6);
  } else if (period === "Monthly") {
    start.setDate(1); end.setMonth(end.getMonth() + 1, 0);
  } else if (period === "Yearly") {
    start.setMonth(0, 1); end.setMonth(11, 31);
  }
  return { period, from: isoDate(start), to: isoDate(end) };
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options?.headers || {}) }, cache: "no-store" });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    console.error(`[API] ${options?.method || "GET"} ${url} failed`, { status: response.status, response: data });
    const message = typeof data.error === "string" ? data.error : "Request failed.";
    const backendError = typeof data.backendError === "string" ? data.backendError : "";
    throw new Error(backendError ? `${message} Backend: ${backendError}` : message);
  }
  return data as T;
}

function downloadReport(type: "appointments" | "clients", range: DateRange, status?: string, selectedServices: string[] = []) {
  const params = new URLSearchParams({ type, from: range.from, to: range.to });
  if (status && status !== "All") params.set("status", status);
  selectedServices.forEach(service => params.append("service", service));
  window.location.assign(`/api/reports?${params.toString()}`);
}

export default function Home() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [tab, setTab] = useState("overview");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [blacklist, setBlacklist] = useState<Blacklisted[]>([]);
  const [toast, setToast] = useState("");
  const [dataError, setDataError] = useState("");

  async function loadData() {
    try {
      const [a, b] = await Promise.all([
        api<{ appointments: Appointment[] }>("/api/appointments"),
        api<{ items: Blacklisted[] }>("/api/blacklist"),
      ]);
      setAppointments(a.appointments); setBlacklist(b.items); setDataError("");
    } catch (error) { setDataError(error instanceof Error ? error.message : "Could not load showroom data."); }
  }

  useEffect(() => {
    api<{ user: SessionUser }>("/api/auth/me").then(({ user }) => { setUser(user); return loadData(); }).catch(() => setUser(null));
  }, []);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(""), 3200); return () => clearTimeout(id); }, [toast]);

  if (user === undefined) return <div className="app-loading"><BrandLogo /><span>Preparing showroom…</span></div>;
  if (!user) return <Login onLogin={(next) => { setUser(next); setTab("overview"); loadData(); }} />;

  const role = user.role;
  const receptionistNav = [["overview", "⌂", "Today"], ["book", "＋", "Book appointment"], ["appointments", "□", "Appointments"], ["visits", "✓", "Visit status"], ["messages", "✦", "Messaging"], ["blacklist", "⊘", "Blacklisted clients"]];
  const managerNav = [["overview", "⌂", "Overview"], ["analytics", "↗", "Client inflow"], ["appointments", "□", "Appointments"], ["blacklist", "⊘", "Blacklisted clients"]];
  const nav = role === "receptionist" ? receptionistNav : managerNav;
  const staffLabel = role === "manager" ? "Manager" : "Receptionist";
  const headings: Record<string, string> = { overview: role === "manager" ? "Showroom performance" : `Good afternoon, ${staffLabel}`, book: "Book an appointment", appointments: "All appointments", visits: "Today’s visit status", messages: "Client messaging", blacklist: "Blacklisted clients", analytics: "Client inflow" };

  async function createAppointment(appointment: BookingPayload) {
    const response = await api<{ appointment: Appointment; delivery?: { email?: { ok: boolean; skipped?: boolean; error?: string } }; whatsappUrl?: string }>("/api/appointments", { method: "POST", body: JSON.stringify(appointment) });
    const { appointment: created, delivery, whatsappUrl } = response;
    setAppointments(v => [...v, created]);

    const hasCustomerEmail = Boolean(created.email.trim());
    if (hasCustomerEmail) {
      const emailResult = delivery?.email;
      if (!emailResult) {
        console.error("[Appointment email] Backend response is missing delivery.email", response);
        setToast("Appointment booked · server did not return email delivery status · WhatsApp not opened");
        setTab("appointments");
        return;
      }

      if (!emailResult.ok) {
        console.error("[Appointment email] Backend email error", {
          appointmentId: created.id,
          recipient: created.email,
          error: emailResult.error || "Email delivery failed",
          skipped: emailResult.skipped || false,
          delivery,
        });
        setToast(`Appointment booked · email failed: ${emailResult.error || "Email delivery failed"} · WhatsApp not opened`);
        setTab("appointments");
        return;
      }

      console.info("[Appointment email] Email sent successfully", { appointmentId: created.id, recipient: created.email });
    }

    if (!whatsappUrl) {
      console.error("[Appointment WhatsApp] Backend response is missing whatsappUrl", response);
      setToast(hasCustomerEmail ? "Appointment booked · email sent · WhatsApp link unavailable" : "Appointment booked · WhatsApp link unavailable");
      setTab("appointments");
      return;
    }

    setToast(hasCustomerEmail ? "Appointment booked · email sent · opening WhatsApp inquiry" : "Appointment booked · opening WhatsApp inquiry");
    window.location.assign(whatsappUrl);
  }
  async function updateAppointment(id: string, patch: Partial<Appointment>) {
    await api(`/api/appointments/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    setAppointments(v => v.map(a => a.id === id ? { ...a, ...patch } : a)); setToast("Appointment updated");
  }
  async function deleteAppointment(id: string) {
    await api(`/api/appointments/${id}`, { method: "DELETE" });
    setAppointments(v => v.filter(a => a.id !== id)); setToast("Appointment deleted");
  }
  async function addBlacklisted(item: Omit<Blacklisted, "id" | "date">) {
    const { item: created } = await api<{ item: Blacklisted }>("/api/blacklist", { method: "POST", body: JSON.stringify(item) });
    setBlacklist(v => [created, ...v]); setToast("Client added to blacklist");
  }
  async function updateBlacklisted(id: string, patch: Omit<Blacklisted, "id" | "date">) {
    await api(`/api/blacklist/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    setBlacklist(v => v.map(item => item.id === id ? { ...item, ...patch } : item));
    setToast("Blacklisted client updated");
  }
  async function deleteBlacklisted(id: string) {
    await api(`/api/blacklist/${id}`, { method: "DELETE" });
    setBlacklist(v => v.filter(item => item.id !== id));
    setToast("Blacklisted client deleted");
  }
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }); setUser(null); setAppointments([]); setBlacklist([]);
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <BrandLogo inverse />
      <nav>{nav.map(([key, icon, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}><span>{icon}</span>{label}</button>)}</nav>
      <div className="profile-card"><span className="avatar">{initials(staffLabel)}</span><div><b>{staffLabel}</b><small>{role === "manager" ? "Showroom Manager" : "Reception Desk"}</small></div><button title="Sign out" onClick={logout}>↗</button></div>
    </aside>
    <main className="workspace">
      <header><div><p>{role === "manager" ? "MANAGEMENT CONSOLE" : new Date().toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long" }).toUpperCase()}</p><h1>{headings[tab]}</h1></div><div className="header-actions">{role === "receptionist" && <button className="primary small" onClick={() => setTab("book")}>＋ New appointment</button>}</div></header>
      {dataError && <div className="api-error">{dataError} <button onClick={loadData}>Retry</button></div>}
      {tab === "overview" && (role === "receptionist" ? <ReceptionistOverview appointments={appointments} onTab={setTab} /> : <ManagerOverview appointments={appointments} onTab={setTab} />)}
      {tab === "book" && <BookingForm appointments={appointments} blacklist={blacklist} onBook={createAppointment} />}
      {tab === "appointments" && <Appointments appointments={appointments} blacklist={blacklist} manager={role === "manager"} onChange={updateAppointment} onDelete={deleteAppointment} />}
      {tab === "visits" && <Visits appointments={appointments} onChange={updateAppointment} />}
      {tab === "messages" && <Messaging appointments={appointments} onNotify={setToast} />}
      {tab === "blacklist" && <Blacklist items={blacklist} onAdd={addBlacklisted} onUpdate={updateBlacklisted} onDelete={deleteBlacklisted} />}
      {tab === "analytics" && <Analytics appointments={appointments} />}
    </main>
    {toast && <div className="toast"><span>✓</span>{toast}</div>}
  </div>;
}

function BrandLogo({ inverse = false }: { inverse?: boolean }) {
  return <div className={`brand ${inverse ? "brand-inverse" : ""}`}><span className="brand-logo-wrap"><Image src="/logo.svg" alt="LAYLA logo" width={118} height={124} priority /></span></div>;
}

function EyeIcon({ crossed = false }: { crossed?: boolean }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.6" />{crossed && <path d="M4 4l16 16" />}</svg>;
}

function PasswordField({ value, onChange, autoComplete, placeholder }: { value: string; onChange: (value: string) => void; autoComplete: string; placeholder?: string }) {
  const [visible, setVisible] = useState(false);
  return <div className="password"><input type={visible ? "text" : "password"} value={value} onChange={e => onChange(e.target.value)} autoComplete={autoComplete} placeholder={placeholder} /><button type="button" className="password-toggle" aria-label={visible ? "Hide password" : "Show password"} title={visible ? "Hide password" : "Show password"} onClick={() => setVisible(v => !v)}><EyeIcon crossed={visible} /></button></div>;
}

function LoginArtwork() {
  return <section className="login-art"><div className="fabric one" /><div className="fabric two" /><div className="editorial"><span>PRIVATE SHOWROOM · DOHA</span><h1>Every fitting,<br /><em>beautifully arranged.</em></h1><p>A considered client experience—from the first call to the final look.</p></div><div className="art-footer">THE PEARL, DOHA · QATAR <span>LAYLA / 01</span></div></section>;
}

function Login({ onLogin }: { onLogin: (user: SessionUser) => void }) {
  const [accountEmails, setAccountEmails] = useState({ receptionist: "reception@atelier.pk", manager: "manager@atelier.pk" });
  const [email, setEmail] = useState("reception@atelier.pk");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "forgot" | "reset">("login");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ managerEmail: string; receptionistEmail: string }>("/api/auth/config")
      .then(config => {
        const next = { manager: config.managerEmail, receptionist: config.receptionistEmail };
        setAccountEmails(next);
        setEmail(current => current === "reception@atelier.pk" ? next.receptionist : current);
      })
      .catch(() => undefined);
    const token = new URLSearchParams(window.location.search).get("reset");
    if (token) Promise.resolve().then(() => { setResetToken(token); setMode("reset"); });
  }, []);

  const selected: Role = email.toLowerCase() === accountEmails.manager.toLowerCase() ? "manager" : "receptionist";

  async function login(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    try { const { user } = await api<{ user: SessionUser }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }); onLogin(user); }
    catch (loginError) { setError(loginError instanceof Error ? loginError.message : "Sign in failed."); }
    finally { setBusy(false); }
  }

  async function requestReset(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<{ message: string }>("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
      setNotice(result.message);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not send the reset email."); }
    finally { setBusy(false); }
  }

  async function resetPassword(e: FormEvent) {
    e.preventDefault(); setError(""); setNotice("");
    if (newPassword.length < 8) { setError("New password must be at least 8 characters."); return; }
    if (newPassword !== confirmPassword) { setError("The new passwords do not match."); return; }
    setBusy(true);
    try {
      const result = await api<{ message: string }>("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ token: resetToken, password: newPassword }) });
      window.history.replaceState({}, "", window.location.pathname);
      setMode("login"); setPassword(""); setNewPassword(""); setConfirmPassword(""); setResetToken(""); setNotice(result.message);
    } catch (resetError) { setError(resetError instanceof Error ? resetError.message : "Could not reset the password."); }
    finally { setBusy(false); }
  }

  if (mode === "forgot") return <main className="login"><LoginArtwork /><section className="login-panel"><form onSubmit={requestReset}><BrandLogo /><div className="welcome"><p>ACCOUNT RECOVERY</p><h2>Forgot your password?</h2><span>Enter the manager or receptionist account email. We&apos;ll send a secure reset link to that address.</span></div><label>Email address<input required type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label>{error && <p className="login-error">{error}</p>}{notice && <p className="login-notice">{notice}</p>}<button className="primary login-button" disabled={busy}>{busy ? "Sending…" : "Send reset link"}<span>→</span></button><button type="button" className="auth-text-button" onClick={() => { setMode("login"); setError(""); setNotice(""); }}>← Back to sign in</button></form></section></main>;

  if (mode === "reset") return <main className="login"><LoginArtwork /><section className="login-panel"><form onSubmit={resetPassword}><BrandLogo /><div className="welcome"><p>SECURE RESET</p><h2>Choose a new password</h2><span>The reset link can be used once and expires automatically.</span></div><label>New password<PasswordField value={newPassword} onChange={setNewPassword} autoComplete="new-password" placeholder="At least 8 characters" /></label><label>Confirm new password<PasswordField value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" placeholder="Repeat new password" /></label>{error && <p className="login-error">{error}</p>}<button className="primary login-button" disabled={busy}>{busy ? "Updating…" : "Reset password"}<span>→</span></button><button type="button" className="auth-text-button" onClick={() => { window.history.replaceState({}, "", window.location.pathname); setMode("login"); setResetToken(""); setError(""); }}>← Back to sign in</button></form></section></main>;

  return <main className="login">
    <LoginArtwork />
    <section className="login-panel"><form onSubmit={login}><BrandLogo /><div className="welcome"><p>WELCOME BACK</p><h2>Sign in to the showroom</h2><span>Use your receptionist or manager account.</span></div>
      <div className="role-switch"><button type="button" className={selected === "receptionist" ? "selected" : ""} onClick={() => { setEmail(accountEmails.receptionist); setPassword(""); }}><b>Receptionist</b><small>Bookings & visits</small></button><button type="button" className={selected === "manager" ? "selected" : ""} onClick={() => { setEmail(accountEmails.manager); setPassword(""); }}><b>Manager</b><small>Performance & oversight</small></button></div>
      <label>Email address<input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" /></label><label>Password<PasswordField value={password} onChange={setPassword} autoComplete="current-password" /></label>
      <div className="login-help-row"><button type="button" className="auth-text-button" onClick={() => { setMode("forgot"); setError(""); setNotice(""); }}>Forgot password?</button></div>
      {error && <p className="login-error">{error}</p>}{notice && <p className="login-notice">{notice}</p>}<button className="primary login-button" disabled={busy}>{busy ? "Signing in…" : "Enter showroom"} <span>→</span></button><p className="demo-note">Account emails and initial credentials are configurable in the environment file.</p>
    </form></section>
  </main>;
}

function Stat({ label, value, note, tone }: { label: string; value: string | number; note: string; tone?: string }) { return <article className={`stat ${tone || ""}`}><div><span>{label}</span><strong>{value}</strong></div><p>{note}</p></article>; }

function ReceptionistOverview({ appointments, onTab }: { appointments: Appointment[]; onTab: (s: string) => void }) {
  const today = isoDate(); const todayAppts = appointments.filter(a => a.date === today);
  return <div className="content"><div className="welcome-strip"><div><span>Today at a glance</span><p>{todayAppts.length} clients are expected. {todayAppts.filter(a => !a.called).length} still need a confirmation call.</p></div><button onClick={() => onTab("visits")}>Update visits →</button></div>
    <section className="stats-grid"><Stat label="TODAY’S APPOINTMENTS" value={todayAppts.length} note={`${todayAppts.filter(a => a.start < "12:00").length} before noon`} /><Stat label="CONFIRMATION CALLS" value={`${todayAppts.filter(a => a.called).length}/${todayAppts.length}`} note={`${todayAppts.filter(a => !a.called).length} awaiting call`} tone="clay" /><Stat label="ARRIVED" value={todayAppts.filter(a => a.status === "Arrived").length} note="Live visit status" tone="green" /><Stat label="NO-SHOWS" value={todayAppts.filter(a => a.status === "No show").length} note="Today" /></section>
    <section className="two-col"><div className="panel"><PanelTitle title="Today’s schedule" action="See all" onClick={() => onTab("appointments")} /><AppointmentRows items={todayAppts} compact /></div><div className="panel"><PanelTitle title="Reception desk" /><div className="tasks"><button onClick={() => onTab("book")}><span>＋</span><div><b>Book a new appointment</b><small>Create a visit and notify the client</small></div><i>→</i></button><button onClick={() => onTab("visits")}><span>✓</span><div><b>Update today’s visits</b><small>Mark arrivals and no-shows</small></div><i>→</i></button><button onClick={() => onTab("blacklist")}><span>⊘</span><div><b>Check blacklisted clients</b><small>Review restricted phone numbers</small></div><i>→</i></button></div></div></section>
  </div>;
}

function ManagerOverview({ appointments, onTab }: { appointments: Appointment[]; onTab: (s: string) => void }) {
  const [range, setRange] = useState<DateRange>(() => rangeForPreset("Weekly"));
  const filtered = useMemo(() => appointments.filter(a => inRange(a.date, range.from, range.to)), [appointments, range]);
  const attended = filtered.filter(a => a.status === "Arrived").length;
  const showRate = filtered.length ? Math.round(attended / filtered.length * 100) : 0;
  return <div className="content"><div className="manager-intro report-intro"><div><p>Operational summary · Doha</p><h2>{range.period === "All" ? "All clients to date" : range.period === "Custom" ? "Custom client view" : `${range.period} client flow`}</h2></div><DateRangeControls range={range} setRange={setRange} appointments={appointments} onExport={() => downloadReport("clients", range)} /></div>
    <section className="stats-grid"><Stat label="CLIENTS" value={uniqueClientCount(filtered)} note={`${range.from} → ${range.to}`} tone="green" /><Stat label="BOOKINGS" value={filtered.length} note="Appointments in selected range" /><Stat label="SHOW RATE" value={`${showRate}%`} note="Arrived visits" tone="clay" /><Stat label="CALL COVERAGE" value={`${filtered.length ? Math.round(filtered.filter(a => a.called).length / filtered.length * 100) : 0}%`} note="Confirmation activity" /></section>
    <section className="two-col manager-grid"><div className="panel chart-panel"><PanelTitle title="Client inflow" action="Full analytics" onClick={() => onTab("analytics")} /><MiniChart items={filtered} from={range.from} to={range.to} /></div><div className="panel"><PanelTitle title="Appointment status" /><StatusDonut items={filtered} /></div></section>
    <div className="panel"><PanelTitle title="Clients in selected range" action="View register" onClick={() => onTab("appointments")} /><AppointmentRows items={filtered.slice(0, 8)} compact manager /></div>
  </div>;
}

function PanelTitle({ title, action, onClick }: { title: string; action?: string; onClick?: () => void }) { return <div className="panel-title"><h3>{title}</h3>{action && <button onClick={onClick}>{action} →</button>}</div>; }

function StatusDonut({ items }: { items: Appointment[] }) {
  const segments = [
    { status: "Walk-in" as Status, label: "Walk-in", color: "#d98b55" },
    { status: "Arrived" as Status, label: "Arrived", color: "#2c8c7a" },
    { status: "Canceled" as Status, label: "Canceled", color: "#b85d67" },
    { status: "No show" as Status, label: "No-show", color: "#7d6b9d" },
  ].map(item => ({ ...item, count: items.filter(a => a.status === item.status).length }));
  const total = segments.reduce((sum, item) => sum + item.count, 0);
  let cursor = 0;
  const gradient = total ? `conic-gradient(${segments.map(item => {
    const start = cursor;
    cursor += item.count / total * 100;
    return `${item.color} ${start}% ${cursor}%`;
  }).join(", ")})` : "#e9ecec";
  return <div className="status-donut-wrap"><div className="status-donut" style={{ background: gradient }}><div><b>{total}</b><span>tracked</span></div></div><ul className="status-donut-legend">{segments.map(item => <li key={item.status}><i style={{ background: item.color }} /><span>{item.label}</span><b>{item.count}</b></li>)}</ul></div>;
}

function AppointmentRows({ items, compact, manager }: { items: Appointment[]; compact?: boolean; manager?: boolean }) { return <div className="appointment-rows">{items.length ? items.map(a => <div className="appointment-row" key={a.id}><time>{formatTimeRange12(a.start, a.end)}</time><span className="mini-avatar">{initials(a.client)}</span><div className="client"><b>{a.client}</b><small>{a.service}</small></div>{manager && <span className={`call ${a.called ? "yes" : ""}`}>{a.called ? "Called" : "Not called"}</span>}<span className={`status ${a.status.toLowerCase().replace(" ", "-")}`}>{a.status}</span>{!compact && <button className="more">•••</button>}</div>) : <div className="empty">No appointments in this range.</div>}</div>; }

function renderBookingTemplate(template: string, form: { client: string; service: string; date: string; start: string; end: string }) {
  const replacements: Record<string, string> = {
    "{name}": form.client.trim() || "Client",
    "{date}": form.date || "appointment date",
    "{time}": form.start && form.end ? formatTimeRange12(form.start, form.end) : "appointment time",
    "{service}": form.service || "your appointment",
  };
  return Object.entries(replacements)
    .reduce((text, [key, value]) => text.split(key).join(value), template)
    .replace(/\batelier\b/gi, "ATELIER");
}

function TimeSelect({ value, onChange, ariaLabel }: { value: string; onChange: (value: string) => void; ariaLabel: string }) {
  const standard = Array.from({ length: 48 }, (_, index) => minutesToTimeValue(index * APPOINTMENT_SLOT_MINUTES));
  const options = standard.includes(value) ? standard : [...standard, value].sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
  return <select required value={value} onChange={e => onChange(e.target.value)} aria-label={ariaLabel}>{options.map(option => <option key={option} value={option}>{formatTime12(option)}</option>)}</select>;
}

function BookingForm({ appointments, blacklist, onBook }: { appointments: Appointment[]; blacklist: Blacklisted[]; onBook: (a: BookingPayload) => Promise<void> }) {
  const [form, setForm] = useState({ client: "", phone: "", email: "", service: String(services[0]), date: isoDate(), start: "10:00", end: "11:00", notes: "", designerAssigned: "", placementStatus: "Not placed" as PlacementStatus });
  const [whatsappMessage, setWhatsappMessage] = useState(DEFAULT_WHATSAPP_INQUIRY_MESSAGE);
  const [emailSubject, setEmailSubject] = useState(DEFAULT_EMAIL_SUBJECT01);
  const [emailMessage, setEmailMessage] = useState(DEFAULT_CLIENT_MESSAGE01);
  const savedTemplate = { subject: DEFAULT_EMAIL_SUBJECT01, message: DEFAULT_CLIENT_MESSAGE01 };
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const blocked = blacklist.find(b => normalizePhone(b.phone) === normalizePhone(form.phone) && form.phone.length > 7);
  const normalizedEmail = form.email.trim().toLowerCase();
  const emailConflict = normalizedEmail.length > 0 && appointments.some(a => a.email.trim().toLowerCase() === normalizedEmail);
  const emailLooksValid = !normalizedEmail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);

  function appendVariable(target: "whatsapp" | "email", variable: string) {
    const append = (current: string) => `${current}${current.endsWith(" ") || current.endsWith("\n") ? "" : " "}${variable}`;
    if (target === "whatsapp") setWhatsappMessage(append); else setEmailMessage(append);
  }

  function restoreSavedTemplate() {
    setWhatsappMessage(DEFAULT_WHATSAPP_INQUIRY_MESSAGE); setEmailMessage(savedTemplate.message); setEmailSubject(savedTemplate.subject);
  }

  async function submit(e: FormEvent) {
    e.preventDefault(); setError("");
    if (blocked) { setError("This phone number belongs to a blacklisted client."); return; }
    if (!/^\d{7,15}$/.test(form.phone)) { setError("Phone number must contain digits only (7 to 15 digits)."); return; }
    if (!emailLooksValid) { setError("Please enter a valid email address."); return; }
    if (emailConflict) { setError("This email address is already used by another appointment."); return; }
    if (form.end <= form.start) { setError("The end time must be later than the start time."); return; }
    if (!whatsappMessage.trim() || !emailSubject.trim() || !emailMessage.trim()) { setError("WhatsApp inquiry, email subject, and email message are required."); return; }
    setBusy(true);
    try { await onBook({ ...form, phone: form.phone.trim(), email: normalizedEmail, whatsappMessage, emailSubject, emailMessage }); }
    catch (bookingError) { setError(bookingError instanceof Error ? bookingError.message : "Could not book appointment."); }
    finally { setBusy(false); }
  }

  const whatsappPreview = renderBookingTemplate(whatsappMessage, form);
  const emailSubjectPreview = renderBookingTemplate(emailSubject, form);
  const emailPreview = renderBookingTemplate(emailMessage, form);

  return <div className="content form-layout"><form className="panel booking-form" onSubmit={submit}><div className="section-head"><span>01</span><div><h3>Client details</h3></div></div>{blocked && <div className="blocked-alert"><b>⊘ This client is blacklisted</b><span>{blocked.name} · {blocked.reason}. An appointment cannot be created for this number.</span></div>}
    <div className="form-grid"><label>Client name<input required placeholder="e.g. Noor Ahmed" value={form.client} onChange={e => setForm({ ...form, client: e.target.value })} /></label><label>Client WhatsApp number<input required inputMode="numeric" pattern="[0-9]*" placeholder="974XXXXXXXX" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value.replace(/\D/g, "") })} /></label><label className="full">Email address (optional)<input type="email" placeholder="client@email.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} aria-invalid={(!emailLooksValid || emailConflict) || undefined} />{!emailLooksValid && <small className="field-error">Enter a valid email format.</small>}{emailLooksValid && emailConflict && <small className="field-error">This email address is already in use.</small>}</label></div>
    <div className="section-head second"><span>02</span><div><h3>Appointment details</h3><p>Select the service and preferred time.</p></div></div><div className="form-grid"><label className="full">Service<select value={form.service} onChange={e => setForm({ ...form, service: e.target.value })}>{services.map(s => <option key={s}>{s}</option>)}</select></label><label>Date<input required type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></label><div className="time-pair"><label>From<TimeSelect value={form.start} onChange={start => setForm({ ...form, start })} ariaLabel="Appointment start time" /></label><label>To<TimeSelect value={form.end} onChange={end => setForm({ ...form, end })} ariaLabel="Appointment end time" /></label></div><label className="full">Designer assigned (optional)<input type="text" placeholder="Designer name" value={form.designerAssigned || ""} onChange={e => setForm({ ...form, designerAssigned: e.target.value })} /></label><label className="full">Notes<textarea placeholder="Preferences, occasion, or special requirements…" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label></div>
    <div className="section-head second notification-section-head"><span>03</span><div><h3>Client notification</h3></div><button type="button" className="secondary-button template-restore" onClick={restoreSavedTemplate}>Use saved template</button></div>
    <div className="booking-message-grid"><div className="booking-message-editor"><label>WhatsApp inquiry<textarea value={whatsappMessage} onChange={e => setWhatsappMessage(e.target.value)} maxLength={4000} /></label><div className="booking-variable-row"><span>Insert:</span>{["{name}", "{date}", "{time}", "{service}"].map(variable => <button type="button" key={variable} onClick={() => appendVariable("whatsapp", variable)}>{variable}</button>)}</div></div><div className="booking-message-editor"><label>Email subject<input value={emailSubject} onChange={e => setEmailSubject(e.target.value)} maxLength={200} /></label><label>Email message<textarea value={emailMessage} onChange={e => setEmailMessage(e.target.value)} maxLength={4000} /></label><div className="booking-variable-row"><span>Insert:</span>{["{name}", "{date}", "{time}", "{service}"].map(variable => <button type="button" key={variable} onClick={() => appendVariable("email", variable)}>{variable}</button>)}</div></div></div>
    {error && <p className="form-error">{error}</p>}<div className="form-actions"><button className="primary" disabled={!!blocked || busy || emailConflict || !emailLooksValid}>{busy ? "Saving…" : "Book & open WhatsApp inquiry →"}</button></div>
  </form><aside className="booking-aside"><div className="panel notification-card"><span className="whatsapp">◉</span><h3>Notification preview</h3><div className="message-preview booking-channel-preview"><small>WHATSAPP INQUIRY</small><p>{whatsappPreview}</p></div><div className="message-preview booking-channel-preview"><small>EMAIL SUBJECT</small><b>{emailSubjectPreview}</b><p>{emailPreview}</p></div></div><div className="panel policy"><h3>Available placeholders</h3><p><code>{`{name}`}</code>, <code>{`{date}`}</code>, <code>{`{time}`}</code>, and <code>{`{service}`}</code> are replaced automatically. <code>{`{time}`}</code> is shown as a 12-hour <b>From … to …</b> time slot.</p></div></aside></div>;
}

function MultiServiceFilter({ selected, open, onChange, onToggle, onClose }: { selected: string[]; open: boolean; onChange: (services: string[]) => void; onToggle: () => void; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const filterRef = useRef<HTMLDivElement>(null);
  const summary = selected.length === 0 ? "All services" : `${selected.length} selected`;
  const detail = selected.length === 0
    ? "Search & select multiple"
    : selected.length === 1
      ? selected[0]
      : `${selected.slice(0, 2).join(", ")}${selected.length > 2 ? ` +${selected.length - 2}` : ""}`;
  const matchingServices = services.filter(service => service.toLowerCase().includes(search.trim().toLowerCase()));

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!filterRef.current?.contains(event.target as Node)) {
        setSearch("");
        onClose();
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSearch("");
        onClose();
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  function toggle(service: string) {
    onChange(selected.includes(service)
      ? selected.filter(item => item !== service)
      : [...selected, service]);
  }

  return <div ref={filterRef} className={`multi-service-filter ${open ? "open" : ""}`}><span>Service</span><button type="button" className={`multi-service-trigger ${open ? "open" : ""}`} aria-expanded={open} aria-controls="service-selection-dropdown" onClick={() => { if (open) setSearch(""); onToggle(); }}><span className="multi-service-search-icon" aria-hidden="true">⌕</span><span className="multi-service-trigger-copy"><b>{summary}</b><small>{detail}</small></span><span className="multi-service-arrow" aria-hidden="true">{open ? "▴" : "▾"}</span></button>{open && <div id="service-selection-dropdown" className="service-selection-dropdown" role="dialog" aria-label="Select services"><label className="service-search"><span aria-hidden="true">⌕</span><input autoFocus type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search services…" aria-label="Search services" />{search && <button type="button" aria-label="Clear service search" onClick={() => setSearch("")}>×</button>}</label>{selected.length > 0 && <div className="selected-service-chips" aria-label="Selected services">{selected.map(service => <button type="button" key={service} onClick={() => toggle(service)} title={`Remove ${service}`}>{service}<span aria-hidden="true">×</span></button>)}</div>}<div className="service-dropdown-options"><button type="button" className={`service-dropdown-option ${selected.length === 0 ? "selected" : ""}`} onClick={() => onChange([])}><span><b>All services</b><small>Show every appointment</small></span>{selected.length === 0 && <i aria-hidden="true">✓</i>}</button>{matchingServices.map(service => { const isSelected = selected.includes(service); return <button type="button" className={`service-dropdown-option ${isSelected ? "selected" : ""}`} aria-pressed={isSelected} key={service} onClick={() => toggle(service)}><span>{service}</span>{isSelected && <i aria-hidden="true">✓</i>}</button>; })}</div>{matchingServices.length === 0 && <div className="service-search-empty">No services match “{search}”.</div>}<div className="service-dropdown-footer"><span>{selected.length === 0 ? "All services" : `${selected.length} selected`}</span><button type="button" onClick={() => { setSearch(""); onClose(); }}>Done</button></div></div>}</div>;
}

function Appointments({ appointments, blacklist, manager, onChange, onDelete }: { appointments: Appointment[]; blacklist: Blacklisted[]; manager: boolean; onChange: (id: string, patch: Partial<Appointment>) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const [range, setRange] = useState<DateRange>(() => rangeForPreset("Monthly"));
  const [filter, setFilter] = useState("All");
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [servicePickerOpen, setServicePickerOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [actionError, setActionError] = useState("");
  const filtered = useMemo(() => appointments.filter(a => (filter === "All" || a.status === filter) && (selectedServices.length === 0 || selectedServices.includes(a.service)) && inRange(a.date, range.from, range.to)), [appointments, filter, selectedServices, range]);
  const calendarItems = useMemo(() => appointments.filter(a => (filter === "All" || a.status === filter) && (selectedServices.length === 0 || selectedServices.includes(a.service))), [appointments, filter, selectedServices]);

  async function removeAppointment(appointment: Appointment) {
    setMenuId(null); setActionError("");
    if (!window.confirm(`Delete ${appointment.client}'s appointment on ${appointment.date}, ${formatTimeRange12(appointment.start, appointment.end)}? This cannot be undone.`)) return;
    try { await onDelete(appointment.id); }
    catch (error) { setActionError(error instanceof Error ? error.message : "Could not delete appointment."); }
  }

  return <div className="content"><div className="filters filters-rich appointment-filters"><DateRangeControls range={range} setRange={setRange} appointments={appointments} onExport={() => downloadReport("appointments", range, filter, selectedServices)} /><div className="appointment-filter-actions"><label>Visit status<select value={filter} onChange={e => setFilter(e.target.value)}><option>All</option>{statusOptions.map(s => <option key={s}>{s}</option>)}</select></label><MultiServiceFilter selected={selectedServices} open={servicePickerOpen} onChange={setSelectedServices} onToggle={() => setServicePickerOpen(value => !value)} onClose={() => setServicePickerOpen(false)} /><button type="button" className={`calendar-toggle ${calendarOpen ? "open" : ""}`} onClick={() => setCalendarOpen(value => !value)}>▣ {calendarOpen ? "Close calendar" : "Open calendar"} <span>{calendarOpen ? "▴" : "▾"}</span></button></div></div>
    {calendarOpen && <AppointmentCalendar appointments={calendarItems} />}
    {actionError && <p className="form-error appointment-action-error">{actionError}</p>}
    <div className="panel table-wrap"><table><thead><tr><th>CLIENT</th><th>DATE & TIME</th><th>SERVICE</th><th>CALL</th><th>VISIT STATUS</th><th>ORDER STATUS</th><th /></tr></thead><tbody>{filtered.map(a => { const isBlocked = blacklist.some(b => normalizePhone(b.phone) === normalizePhone(a.phone)); return <tr key={a.id}><td><div className="table-client"><span className="mini-avatar">{initials(a.client)}</span><div><b>{a.client}</b><small>{a.phone}</small></div>{isBlocked && <em>BLACKLISTED</em>}</div></td><td><b>{a.date === isoDate() ? "Today" : a.date}</b><small>{formatTimeRange12(a.start, a.end)}</small></td><td>{a.service}</td><td><button className={`call-toggle ${a.called ? "done" : ""}`} disabled={manager} onClick={() => onChange(a.id, { called: !a.called })}>{a.called ? "✓ Called" : "Mark called"}</button></td><td><select className={`status-select ${a.status.toLowerCase().replace(" ", "-")}`} value={a.status} disabled={manager} onChange={e => onChange(a.id, { status: e.target.value as Status })}>{statusOptions.map(s => <option key={s}>{s}</option>)}</select></td><td><select className="status-select placement-select" value={a.placementStatus || "Not placed"} disabled={manager} onChange={e => onChange(a.id, { placementStatus: e.target.value as PlacementStatus })}>{placementOptions.map(s => <option key={s}>{s}</option>)}</select></td><td className="appointment-actions-cell"><button className="more" aria-label={`Actions for ${a.client}`} aria-expanded={menuId === a.id} onClick={() => setMenuId(menuId === a.id ? null : a.id)}>•••</button>{menuId === a.id && <div className="appointment-menu"><button onClick={() => { setEditing(a); setMenuId(null); setActionError(""); }}><span>✎</span>Edit appointment</button><button className="danger" onClick={() => removeAppointment(a)}><span>×</span>Delete appointment</button></div>}</td></tr>; })}</tbody></table>{!filtered.length && <div className="empty">No appointments match this date range, status, and service.</div>}</div>
    {editing && <EditAppointmentModal appointment={editing} appointments={appointments} blacklist={blacklist} onClose={() => setEditing(null)} onSave={async (patch) => { await onChange(editing.id, patch); setEditing(null); }} />}
  </div>;
}

type CalendarView = "Daily" | "Weekly" | "Monthly" | "Yearly";

function addDays(date: Date, amount: number) { const next = new Date(date); next.setDate(next.getDate() + amount); return next; }
function startOfWeek(date: Date) { const next = new Date(date); const offset = (next.getDay() + 6) % 7; next.setDate(next.getDate() - offset); next.setHours(12, 0, 0, 0); return next; }
function moveCalendarDate(anchor: Date, view: CalendarView, direction: number) { const next = new Date(anchor); if (view === "Daily") next.setDate(next.getDate() + direction); else if (view === "Weekly") next.setDate(next.getDate() + direction * 7); else if (view === "Monthly") next.setMonth(next.getMonth() + direction); else next.setFullYear(next.getFullYear() + direction); return next; }
function calendarHeading(anchor: Date, view: CalendarView) { if (view === "Daily") return anchor.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); if (view === "Weekly") { const start = startOfWeek(anchor); const end = addDays(start, 6); return `${start.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`; } if (view === "Monthly") return anchor.toLocaleDateString("en-GB", { month: "long", year: "numeric" }); return String(anchor.getFullYear()); }

function CalendarAppointment({ appointment }: { appointment: Appointment }) {
  return <div className={`calendar-appointment ${appointment.status.toLowerCase().replace(" ", "-")}`} title={`${appointment.client} · ${appointment.service} · ${formatTimeRange12(appointment.start, appointment.end)}`}><b>{appointment.client}</b><span>{formatTimeRange12(appointment.start, appointment.end)}</span><small>{appointment.service}</small></div>;
}

function ScheduleTimeGrid({ dates, appointments }: { dates: Date[]; appointments: Appointment[] }) {
  const firstMinute = 0;
  const lastMinute = 23 * 60 + 30;
  const slots: number[] = [];
  for (let minute = firstMinute; minute <= lastMinute; minute += APPOINTMENT_SLOT_MINUTES) slots.push(minute);
  return <div className="schedule-grid-scroll"><div className="schedule-grid" style={{ gridTemplateColumns: `86px repeat(${dates.length}, minmax(145px, 1fr))` }}><div className="schedule-corner">TIME</div>{dates.map(date => <div className={`schedule-day-head ${isoDate(date) === isoDate() ? "today" : ""}`} key={isoDate(date)}><b>{date.toLocaleDateString("en-GB", { weekday: "short" })}</b><span>{date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></div>)}{slots.flatMap(slot => [<div className="schedule-time" key={`time-${slot}`}>{formatTime12(minutesToTimeValue(slot))}</div>, ...dates.map(date => { const key = isoDate(date); const cellItems = appointments.filter(item => item.date === key && timeToMinutes(item.start) >= slot && timeToMinutes(item.start) < slot + APPOINTMENT_SLOT_MINUTES).sort((a, b) => a.start.localeCompare(b.start)); return <div className="schedule-cell" key={`${key}-${slot}`}>{cellItems.map(item => <CalendarAppointment appointment={item} key={item.id} />)}</div>; })])}</div></div>;
}

function MonthCalendar({ anchor, appointments }: { anchor: Date; appointments: Appointment[] }) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12);
  const offset = (first.getDay() + 6) % 7;
  const gridStart = addDays(first, -offset);
  const days = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  return <div className="month-calendar"><div className="month-weekdays">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => <span key={day}>{day}</span>)}</div><div className="month-days">{days.map(day => { const key = isoDate(day); const dayAppointments = appointments.filter(item => item.date === key).sort((a, b) => a.start.localeCompare(b.start)); const inMonth = day.getMonth() === anchor.getMonth(); return <div className={`month-day ${inMonth ? "" : "outside"} ${key === isoDate() ? "today" : ""}`} key={key}><b>{day.getDate()}</b><div>{dayAppointments.slice(0, 3).map(item => <div className={`month-event ${item.status.toLowerCase().replace(" ", "-")}`} key={item.id}><span>{formatTimeRange12(item.start, item.end)}</span>{item.client}</div>)}{dayAppointments.length > 3 && <small>+{dayAppointments.length - 3} more</small>}</div></div>; })}</div></div>;
}

function YearCalendar({ anchor, appointments, onOpenMonth }: { anchor: Date; appointments: Appointment[]; onOpenMonth: (month: number) => void }) {
  const year = anchor.getFullYear();
  return <div className="year-calendar">{Array.from({ length: 12 }, (_, month) => { const first = new Date(year, month, 1, 12); const offset = (first.getDay() + 6) % 7; const daysInMonth = new Date(year, month + 1, 0).getDate(); const cells = Array.from({ length: offset + daysInMonth }, (_, index) => index < offset ? null : index - offset + 1); return <button type="button" className="year-month" key={month} onClick={() => onOpenMonth(month)}><h4>{first.toLocaleDateString("en-GB", { month: "long" })}</h4><div className="year-weekdays">{["M", "T", "W", "T", "F", "S", "S"].map((day, i) => <span key={`${day}-${i}`}>{day}</span>)}</div><div className="year-month-days">{cells.map((day, index) => day === null ? <span key={`blank-${index}`} /> : (() => { const key = isoDate(new Date(year, month, day, 12)); const count = appointments.filter(item => item.date === key).length; return <span className={count ? "has-events" : ""} key={key}>{day}{count > 0 && <i>{count}</i>}</span>; })())}</div></button>; })}</div>;
}

function AppointmentCalendar({ appointments }: { appointments: Appointment[] }) {
  const [view, setView] = useState<CalendarView>("Weekly");
  const [anchor, setAnchor] = useState(() => new Date());
  const weekStart = startOfWeek(anchor);
  const weekDates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  return <section className="panel appointment-calendar"><div className="calendar-toolbar"><div><span>APPOINTMENT CALENDAR</span><h3>{calendarHeading(anchor, view)}</h3></div><div className="calendar-navigation"><button type="button" aria-label="Previous" onClick={() => setAnchor(current => moveCalendarDate(current, view, -1))}>←</button><button type="button" onClick={() => setAnchor(new Date())}>Today</button><button type="button" aria-label="Next" onClick={() => setAnchor(current => moveCalendarDate(current, view, 1))}>→</button></div><div className="calendar-view-switch">{(["Daily", "Weekly", "Monthly", "Yearly"] as CalendarView[]).map(option => <button type="button" key={option} className={view === option ? "active" : ""} onClick={() => setView(option)}>{option}</button>)}</div></div><div className="calendar-body">{view === "Daily" && <ScheduleTimeGrid dates={[anchor]} appointments={appointments} />}{view === "Weekly" && <ScheduleTimeGrid dates={weekDates} appointments={appointments} />}{view === "Monthly" && <MonthCalendar anchor={anchor} appointments={appointments} />}{view === "Yearly" && <YearCalendar anchor={anchor} appointments={appointments} onOpenMonth={month => { setAnchor(new Date(anchor.getFullYear(), month, 1, 12)); setView("Monthly"); }} />}</div></section>;
}

function EditAppointmentModal({ appointment, appointments, blacklist, onClose, onSave }: { appointment: Appointment; appointments: Appointment[]; blacklist: Blacklisted[]; onClose: () => void; onSave: (patch: Partial<Appointment>) => Promise<void> }) {
  const [form, setForm] = useState<Appointment>({ ...appointment, phone: appointment.phone.replace(/\D/g, "") });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const blocked = blacklist.find(b => normalizePhone(b.phone) === normalizePhone(form.phone) && normalizePhone(b.phone) !== normalizePhone(appointment.phone));
  const normalizedEmail = form.email.trim().toLowerCase();
  const emailConflict = normalizedEmail.length > 0 && appointments.some(item => item.id !== appointment.id && item.email.trim().toLowerCase() === normalizedEmail);
  const emailLooksValid = !normalizedEmail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);

  async function submit(e: FormEvent) {
    e.preventDefault(); setError("");
    if (blocked) { setError("The new phone number is blacklisted."); return; }
    if (!/^\d{7,15}$/.test(form.phone)) { setError("Phone number must contain digits only (7 to 15 digits)."); return; }
    if (!emailLooksValid) { setError("Please enter a valid email address."); return; }
    if (emailConflict) { setError("This email address is already used by another appointment."); return; }
    if (form.end <= form.start) { setError("The end time must be later than the start time."); return; }
    setBusy(true);
    try {
      await onSave({ client: form.client, phone: form.phone, email: normalizedEmail, service: form.service, date: form.date, start: form.start, end: form.end, status: form.status, called: form.called, notes: form.notes || "", designerAssigned: form.designerAssigned || "", placementStatus: form.placementStatus || "Not placed" });
    } catch (err) { setError(err instanceof Error ? err.message : "Could not update appointment."); }
    finally { setBusy(false); }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className="appointment-modal" role="dialog" aria-modal="true" aria-labelledby="edit-appointment-title"><div className="modal-head"><div><span>APPOINTMENT ACTION</span><h2 id="edit-appointment-title">Edit appointment</h2></div><button type="button" className="modal-close" aria-label="Close" onClick={onClose}>×</button></div><form onSubmit={submit}><div className="form-grid"><label>Client name<input required value={form.client} onChange={e => setForm({ ...form, client: e.target.value })} /></label><label>WhatsApp number<input required inputMode="numeric" pattern="[0-9]*" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value.replace(/\D/g, "") })} /></label><label className="full">Email (optional)<input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />{!emailLooksValid && <small className="field-error">Enter a valid email format.</small>}{emailLooksValid && emailConflict && <small className="field-error">This email address is already in use.</small>}</label><label className="full">Service<select value={form.service} onChange={e => setForm({ ...form, service: e.target.value })}>{services.map(service => <option key={service}>{service}</option>)}</select></label><label className="full">Designer assigned (optional)<input type="text" placeholder="Designer name" value={form.designerAssigned || ""} onChange={e => setForm({ ...form, designerAssigned: e.target.value })} /></label><label>Date<input required type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></label><div className="time-pair"><label>From<TimeSelect value={form.start} onChange={start => setForm({ ...form, start })} ariaLabel="Appointment start time" /></label><label>To<TimeSelect value={form.end} onChange={end => setForm({ ...form, end })} ariaLabel="Appointment end time" /></label></div><label>Visit status<select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as Status })}>{statusOptions.map(status => <option key={status}>{status}</option>)}</select></label><label>Order Status<select value={form.placementStatus || "Not placed"} onChange={e => setForm({ ...form, placementStatus: e.target.value as PlacementStatus })}>{placementOptions.map(status => <option key={status}>{status}</option>)}</select></label><label className="called-check"><input type="checkbox" checked={form.called} onChange={e => setForm({ ...form, called: e.target.checked })} />Client has been called</label><label className="full">Notes<textarea value={form.notes || ""} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Preferences, occasion, or special requirements…" /></label></div>{blocked && <div className="blocked-alert"><b>⊘ Blacklisted number</b><span>{blocked.name} · {blocked.reason}</span></div>}{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !!blocked || emailConflict || !emailLooksValid}>{busy ? "Saving…" : "Save changes"}</button></div></form></div></div>;
}

function DateRangeControls({ range, setRange, appointments, onExport }: { range: DateRange; setRange: (range: DateRange) => void; appointments: Appointment[]; onExport?: () => void }) {
  function preset(period: Exclude<Period, "Custom">) {
    setRange(period === "All" ? allClientsRange(appointments) : rangeForPreset(period));
  }
  return <div className="date-range-controls"><PeriodFilter value={range.period} onChange={preset} /><div className="date-pickers"><label>From<input type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value, period: "Custom" })} /></label><span>→</span><label>To<input type="date" value={range.to} min={range.from} onChange={e => setRange({ ...range, to: e.target.value, period: "Custom" })} /></label></div>{range.period === "All" && <span className="all-range-pill">All clients to date</span>}{range.period === "Custom" && <span className="custom-range-pill">Custom</span>}{onExport && <button className="export-button" onClick={onExport}>↓ Export PDF</button>}</div>;
}

function Visits({ appointments, onChange }: { appointments: Appointment[]; onChange: (id: string, patch: Partial<Appointment>) => Promise<void> }) {
  const items = appointments.filter(a => a.date === isoDate());
  return <div className="content"><div className="visit-summary"><p>Keep today’s call, visit and order status details aligned with the Appointments tab.</p><span>{items.length} appointment{items.length === 1 ? "" : "s"} today</span></div><div className="visit-grid">{items.map(a => <article className="panel visit-card" key={a.id}><div className="visit-top"><time>{formatTimeRange12(a.start, a.end)}</time><span className={`call ${a.called ? "yes" : ""}`}>{a.called ? "✓ Called" : "Call pending"}</span></div><span className="large-avatar">{initials(a.client)}</span><h3>{a.client}</h3><p>{a.service}</p><div className="visit-status-controls"><label>Call<select value={a.called ? "called" : "not-called"} onChange={e => onChange(a.id, { called: e.target.value === "called" })}><option value="called">Marked called</option><option value="not-called">Not called</option></select></label><label>Visit status<select className={`status-select ${a.status.toLowerCase().replace(" ", "-")}`} value={a.status} onChange={e => onChange(a.id, { status: e.target.value as Status })}>{statusOptions.map(status => <option key={status}>{status}</option>)}</select></label><label>Order status<select className="status-select placement-select" value={a.placementStatus || "Not placed"} onChange={e => onChange(a.id, { placementStatus: e.target.value as PlacementStatus })}>{placementOptions.map(status => <option key={status}>{status}</option>)}</select></label></div></article>)}{!items.length && <div className="empty panel">No appointments scheduled for today.</div>}</div></div>;
}

function Blacklist({ items, onAdd, onUpdate, onDelete }: { items: Blacklisted[]; onAdd: (b: Omit<Blacklisted, "id" | "date">) => Promise<void>; onUpdate: (id: string, b: Omit<Blacklisted, "id" | "date">) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", reason: "" });
  const [editing, setEditing] = useState<Blacklisted | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const duplicatePhone = form.phone.length > 0 && items.some(item => item.id !== editing?.id && normalizePhone(item.phone) === normalizePhone(form.phone));

  function startAdd() { setEditing(null); setForm({ name: "", phone: "", reason: "" }); setError(""); setShow(true); }
  function startEdit(item: Blacklisted) { setEditing(item); setForm({ name: item.name, phone: item.phone.replace(/\D/g, ""), reason: item.reason }); setError(""); setMenuId(null); setShow(true); }
  function cancelForm() { setShow(false); setEditing(null); setForm({ name: "", phone: "", reason: "" }); setError(""); }

  async function submit(e: FormEvent) {
    e.preventDefault(); setError("");
    if (!/^\d{7,15}$/.test(form.phone)) { setError("Phone number must contain digits only (7 to 15 digits)."); return; }
    if (duplicatePhone) { setError("That phone number is already blacklisted."); return; }
    try {
      if (editing) await onUpdate(editing.id, form); else await onAdd(form);
      cancelForm();
    } catch (e) { setError(e instanceof Error ? e.message : editing ? "Could not update client." : "Could not add client."); }
  }

  async function remove(item: Blacklisted) {
    setMenuId(null); setError("");
    if (!window.confirm(`Remove ${item.name} from the blacklist?`)) return;
    try { await onDelete(item.id); if (editing?.id === item.id) cancelForm(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not delete blacklisted client."); }
  }

  return <div className="content"><div className="blacklist-head"><p>Appointments using these phone numbers are blocked automatically.</p><button className="primary small" onClick={() => show && !editing ? cancelForm() : startAdd()}>{show && !editing ? "Close" : "＋ Add client"}</button></div>{show && <form className="panel inline-form blacklist-form" onSubmit={submit}><label>Client name<input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label><label>Phone number<input required inputMode="numeric" pattern="[0-9]*" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value.replace(/\D/g, "") })} />{duplicatePhone && <small className="field-error">This number is already blacklisted.</small>}</label><label>Reason<input required value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} /></label><div className="blacklist-form-actions"><button className="primary" disabled={duplicatePhone}>{editing ? "Save changes" : "Add to blacklist"}</button>{editing && <button type="button" className="secondary-button" onClick={cancelForm}>Cancel</button>}</div>{error && <p className="form-error blacklist-form-error">{error}</p>}</form>}{error && !show && <p className="form-error">{error}</p>}<div className="panel table-wrap"><table><thead><tr><th>CLIENT</th><th>PHONE NUMBER</th><th>REASON</th><th>ADDED</th><th /></tr></thead><tbody>{items.map(b => <tr key={b.id}><td><div className="table-client"><span className="mini-avatar blocked">{initials(b.name)}</span><b>{b.name}</b><em>BLACKLISTED</em></div></td><td>{b.phone}</td><td>{b.reason}</td><td>{b.date}</td><td className="appointment-actions-cell"><button className="more" aria-label={`Actions for ${b.name}`} aria-expanded={menuId === b.id} onClick={() => setMenuId(menuId === b.id ? null : b.id)}>•••</button>{menuId === b.id && <div className="appointment-menu"><button type="button" onClick={() => startEdit(b)}><span>✎</span>Edit client</button><button type="button" className="danger" onClick={() => remove(b)}><span>×</span>Delete client</button></div>}</td></tr>)}</tbody></table>{!items.length && <div className="empty">No blacklisted clients.</div>}</div></div>;
}

function PeriodFilter({ value, onChange }: { value: Period; onChange: (v: Exclude<Period, "Custom">) => void }) { return <div className="segmented period-filter">{(["All", "Daily", "Weekly", "Monthly", "Yearly"] as const).map(p => <button key={p} className={value === p ? "selected" : ""} onClick={() => onChange(p)}>{p === "All" ? "All clients" : p}</button>)}</div>; }

function chartData(items: Appointment[], from: string, to: string) {
  const start = dateFromIso(from); const end = dateFromIso(to); const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  if (days <= 1) {
    const labels = ["9am", "11am", "1pm", "3pm", "5pm", "7pm"]; const starts = [9, 11, 13, 15, 17, 19];
    return { labels, values: starts.map((h, i) => items.filter(a => { const hour = Number(a.start.slice(0, 2)); return hour >= h && hour < (starts[i + 1] ?? 24); }).length) };
  }
  if (days <= 14) {
    const labels: string[] = []; const values: number[] = [];
    for (let i = 0; i < days; i++) { const d = new Date(start); d.setDate(start.getDate() + i); const iso = isoDate(d); labels.push(d.toLocaleDateString("en", { weekday: "short", day: "numeric" })); values.push(items.filter(a => a.date === iso).length); }
    return { labels, values };
  }
  if (days <= 70) {
    const count = Math.ceil(days / 7); return { labels: Array.from({ length: count }, (_, i) => `W${i + 1}`), values: Array.from({ length: count }, (_, i) => items.filter(a => { const diff = Math.floor((dateFromIso(a.date).getTime() - start.getTime()) / 86400000); return diff >= i * 7 && diff < (i + 1) * 7; }).length) };
  }
  const months: { key: string; label: string }[] = []; const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end && months.length < 12) { months.push({ key: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`, label: cursor.toLocaleDateString("en", { month: "short" }) }); cursor.setMonth(cursor.getMonth() + 1); }
  return { labels: months.map(m => m.label), values: months.map(m => items.filter(a => a.date.startsWith(m.key)).length) };
}
function MiniChart({ items, from, to }: { items: Appointment[]; from: string; to: string }) { const set = chartData(items, from, to); const max = Math.max(1, ...set.values); return <div className="mini-chart"><div className="chart-y"><span>{max}</span><span>{Math.round(max * .66)}</span><span>{Math.round(max * .33)}</span><span>0</span></div><div className="bars">{set.values.map((n, i) => <div key={`${set.labels[i]}-${i}`}><span style={{ height: `${Math.max(4, n / max * 118)}px` }} /><small>{set.labels[i]}</small></div>)}</div></div>; }

function Analytics({ appointments }: { appointments: Appointment[] }) {
  const [range, setRange] = useState<DateRange>(() => rangeForPreset("Monthly"));
  const filtered = useMemo(() => appointments.filter(a => inRange(a.date, range.from, range.to)), [appointments, range]);
  const attended = filtered.filter(a => a.status === "Arrived").length; const noShow = filtered.filter(a => a.status === "No show").length; const showRate = filtered.length ? Math.round(attended / filtered.length * 100) : 0;
  return <div className="content"><div className="analytics-head report-intro"><div><span>REPORTING RANGE</span><h2>{range.period === "All" ? "All clients performance" : range.period === "Custom" ? "Custom performance" : `${range.period} performance`}</h2></div><DateRangeControls range={range} setRange={setRange} appointments={appointments} onExport={() => downloadReport("clients", range)} /></div><section className="stats-grid"><Stat label="CLIENTS" value={uniqueClientCount(filtered)} note={`${range.from} → ${range.to}`} /><Stat label="ATTENDED" value={attended} note={`${showRate}% show rate`} tone="green" /><Stat label="NO-SHOWS" value={noShow} note="Requires follow-up" tone="clay" /><Stat label="TOTAL BOOKINGS" value={filtered.length} note="Selected date range" /></section><section className="two-col manager-grid"><div className="panel chart-panel large"><PanelTitle title="Appointments over time" /><MiniChart items={filtered} from={range.from} to={range.to} /></div><div className="panel"><PanelTitle title="Service mix" /><div className="service-mix">{services.map(s => { const count = filtered.filter(a => a.service === s).length; const pct = filtered.length ? Math.round(count / filtered.length * 100) : 0; return <div key={s}><span>{s}</span><div><i style={{ width: `${Math.max(count ? 8 : 0, pct)}%` }} /></div><b>{count}</b></div>; })}</div></div></section></div>;
}

function Messaging({ appointments, onNotify }: { appointments: Appointment[]; onNotify: (message: string) => void }) {
  const [subject, setSubject] = useState(DEFAULT_EMAIL_SUBJECT02);
  const [message, setMessage] = useState(DEFAULT_CLIENT_MESSAGE02);
  const [audience, setAudience] = useState<MessageAudience>("all");
  const channel: MessageChannel = "email";
  const [customFrom, setCustomFrom] = useState(isoDate());
  const [customTo, setCustomTo] = useState(isoDate());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [attachment, setAttachment] = useState<EmailAttachment | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<string>("");

  const audienceRange = useMemo<DateRange>(() => {
    if (audience === "all") return allClientsRange(appointments);
    if (audience === "week") return rangeForPreset("Weekly");
    if (audience === "month") return rangeForPreset("Monthly");
    if (audience === "year") return rangeForPreset("Yearly");
    return { period: "Custom", from: customFrom, to: customTo };
  }, [audience, appointments, customFrom, customTo]);

  const audienceAppointments = useMemo(() => appointments.filter(a => inRange(a.date, audienceRange.from, audienceRange.to)), [appointments, audienceRange]);
  const clientCount = uniqueClientCount(audienceAppointments);

  function chooseImage(file?: File) {
    if (!file) return;
    setError("");
    if (!file.type.startsWith("image/")) { setError("Please select an image file."); return; }
    if (file.size > 5 * 1024 * 1024) { setError("Image attachment must be 5 MB or smaller."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || "");
      const base64 = url.split(",")[1] || "";
      setAttachment({ name: file.name, type: file.type, data: base64 });
      setAttachmentPreview(url);
    };
    reader.readAsDataURL(file);
  }

  async function sendCampaign() {
    setSending(true); setError("");
    try {
      const result = await api<{ clientCount: number; emailDelivered: number; emailFailed: number; emailSkipped: number }>("/api/messages/send", {
        method: "POST",
        body: JSON.stringify({ audience, channel, from: audienceRange.from, to: audienceRange.to, subject, message, attachment }),
      });
      const incomplete = result.emailFailed + result.emailSkipped;
      onNotify(incomplete
        ? `Email campaign processed for ${result.clientCount} clients · ${result.emailDelivered} delivered · ${incomplete} need attention`
        : `Email campaign sent to ${result.clientCount} clients · ${result.emailDelivered} delivered`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not process the email campaign."); }
    finally { setSending(false); }
  }

  return <div className="content message-layout">
    <section className="panel composer">
      <div className="composer-head"><div><span>CLIENT EMAIL CAMPAIGNS</span></div><span className="audience-pill">{clientCount} clients</span></div>
      <div className="campaign-builder">
        <label>Audience<select value={audience} onChange={e => setAudience(e.target.value as MessageAudience)}><option value="all">All clients</option><option value="week">This week&apos;s clients</option><option value="month">This month&apos;s clients</option><option value="year">This year&apos;s clients</option><option value="custom">Select date range</option></select></label>
        <label>Channel<select value="email" disabled><option value="email">Email only</option></select></label>
      </div>
      {audience === "custom" && <div className="message-date-range"><label>From<input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} /></label><span>→</span><label>To<input type="date" min={customFrom} value={customTo} onChange={e => setCustomTo(e.target.value)} /></label></div>}
      <div className="audience-summary"><b>{clientCount} clients</b><span>{audienceRange.from} → {audienceRange.to}</span></div>
      <label className="message-field-label">Email subject<input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Eid Mubarak" /></label>
      <label className="message-field-label">Message<textarea className="rich-editor" value={message} onChange={e => setMessage(e.target.value)} placeholder="Write the message that will be sent to clients…" /></label>
      <div className="email-attachment-field"><div><b>Image attachment</b><small>Optional · JPG, PNG, GIF or other image · max 5 MB</small></div><label className="secondary-button attachment-button">＋ Choose image<input type="file" accept="image/*" onChange={e => chooseImage(e.target.files?.[0])} /></label></div>
      {attachment && <div className="attachment-selected"><img src={attachmentPreview} alt="Email attachment preview" /><div><b>{attachment.name}</b><small>{attachment.type}</small></div><button type="button" onClick={() => { setAttachment(null); setAttachmentPreview(""); }}>Remove</button></div>}
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions"><div className="message-action-buttons"><button type="button" className="primary" disabled={sending || clientCount === 0 || (audience === "custom" && customFrom > customTo) || !subject.trim() || !message.trim()} onClick={sendCampaign}>{sending ? "Sending…" : `Send email to ${clientCount} clients →`}</button></div></div>
    </section>
    <aside className="panel phone-preview message-preview">
      <div className="phone-top"><span>✉</span><div><b>LAYLA Doha</b><small>Email campaign</small></div><i>•••</i></div>
      <div className="email-preview"><span>EMAIL SUBJECT</span><b>{subject}</b></div>
      <div className="chat"><span className="chat-date">EMAIL PREVIEW</span>{attachmentPreview && <img className="campaign-image-preview" src={attachmentPreview} alt="Attachment preview" />}<div className="bubble">{message.split("\n").map((line, i) => <p key={i}>{line || <br />}</p>)}<small>Email only</small></div></div>
    </aside>
  </div>;
}
