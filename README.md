# LAYLA Showroom Manager

Responsive Next.js showroom appointment and client-management dashboard using MongoDB Atlas, signed HTTP-only JWT sessions, WhatsApp click-to-chat inquiries, email delivery, password recovery, date-range reporting, and PDF exports.

## Current functionality

- Receptionist and Manager identities are generic role labels only; no fixed staff member name is hard-coded in the UI.
- Account emails come from environment variables: `RECEPTIONIST_EMAIL` and `MANAGER_EMAIL`.
- Login includes a password visibility eye toggle.
- **Forgot password** sends a one-time reset link to the entered staff account email using the configured Gmail SMTP account. Reset tokens are hashed in MongoDB, expire automatically, and are invalid after use.
- Appointment creation saves the client details, opens a prefilled WhatsApp inquiry to **+92 333 7109448**, and attempts the appointment email when Gmail SMTP is configured.
- The **Book appointment** form contains a dedicated Client notification section where the receptionist can customize, for that individual booking:
  - WhatsApp inquiry text (opened through `wa.me`)
  - Email subject
  - Email message
- Appointment notification fields support `{name}`, `{date}`, `{time}`, and `{service}` placeholders. The saved Messaging template is loaded as the starting wording, but it can be changed before each booking without changing the global template.
- Appointment services include **Engagement Dress** alongside the existing showroom and fitting services in both booking and editing flows.
- Receptionist and Manager appointment views support selecting multiple services in the service filter.
- The Daily and Weekly appointment calendars display the showroom schedule from **8:00 AM to 6:00 PM**.
- A client phone number may be reused for multiple appointments; phone format and blacklist checks remain enforced.
- Every appointment row has a three-dot menu with **Edit appointment** and **Delete appointment**.
- Messaging campaigns can target All clients, This week's clients, This month's clients, This year's clients, or clients within a custom From/To range.
- Bulk messaging supports **WhatsApp only**, **Email only**, and **WhatsApp + Email**. Email is sent through Gmail SMTP. WhatsApp messages are prepared as client-specific click-to-chat links and require staff to press **Send** in each chat.
- The reusable campaign message/email subject can be saved in MongoDB.
- All-clients, daily, weekly, monthly, yearly, and custom date reporting remains available, including PDF export.
- Responsive layouts cover phones, tablets, laptops, and large screens.

## Local setup

1. Copy `.env.example` to `.env.local` if starting from a clean configuration.
2. Fill in MongoDB and JWT values. Set `NEXT_PUBLIC_WHATSAPP_BUSINESS_NUMBER=923337109448`. Gmail SMTP settings are required for email sending.
3. Run `npm install`.
4. Run `npm run dev`.
5. Open `http://localhost:3000` unless `APP_URL` / `PORT` were changed.

The included default development accounts are controlled entirely from `.env`:

- Manager email: `MANAGER_EMAIL`
- Manager initial password: `SEED_MANAGER_PASSWORD`
- Receptionist email: `RECEPTIONIST_EMAIL`
- Receptionist initial password: `SEED_RECEPTIONIST_PASSWORD`

Change the default passwords and production secrets before a public launch.

## Environment variables

### Server / URLs

- `PORT` - Node/Next server port; default `3000`.
- `APP_URL` and `NEXT_PUBLIC_APP_URL` - application/domain URL. The password-reset email uses `APP_URL` when generating its reset link.
- `API_BASE_URL` and `NEXT_PUBLIC_API_BASE_URL` - API URL/path.

### MongoDB

- `MONGODB_URI` - MongoDB connection string.
- `MONGODB_DB` - database name; currently `mern_admin`.

### Authentication and password recovery

- `JWT_SECRET` - long random signing secret.
- `JWT_COOKIE_NAME` - HTTP-only session cookie name.
- `JWT_EXPIRES_IN_SECONDS` - login session duration.
- `MANAGER_EMAIL` - Manager login/reset email.
- `RECEPTIONIST_EMAIL` - Receptionist login/reset email.
- `SEED_MANAGER_PASSWORD` - Manager password used only when creating the account for the first time.
- `SEED_RECEPTIONIST_PASSWORD` - Receptionist password used only when creating the account for the first time.
- `PASSWORD_RESET_TTL_MINUTES` - one-time reset-link lifetime; default `30` minutes.

For compatibility with an older environment, the bootstrap code also accepts the legacy `SEED_MANAGER_EMAIL` and `SEED_RECEPTIONIST_EMAIL` variables if the new email variables are not present.

### WhatsApp inquiry (no Meta account required)

- `NEXT_PUBLIC_WHATSAPP_BUSINESS_NUMBER` - WhatsApp destination number in international digits-only format. This project is configured for `923337109448` (+92 333 7109448).
- `NEXT_PUBLIC_WHATSAPP_DEFAULT_COUNTRY_CODE` - default country code for client numbers entered without an international prefix; configured as `974` for Qatar.
- The app generates `https://wa.me/923337109448?text=...` links. WhatsApp opens with the inquiry prefilled and the user presses **Send**.
- There is no WhatsApp Business Cloud API access token, Phone Number ID, or Meta Developer setup.

### Email delivery

Email is sent directly through Gmail SMTP. No Resend account or email template is required.

- `EMAIL_USER` - Gmail address used to send email, for example `laylaatelier85@gmail.com`.
- `EMAIL_APP_PASSWORD` - Google App Password created after enabling 2-Step Verification. Do not use the normal Gmail password.
- `EMAIL_FROM_NAME` - display name for outgoing email, for example `LAYLA Atelier`.

The same Gmail SMTP sender is used for client appointment emails, bulk campaign emails, and staff password-reset links.

## Appointment notification behavior

When a receptionist opens **Book appointment**, the WhatsApp inquiry starts with a click-to-chat template and the saved Messaging template is used for email. Both can be changed for that booking only.

After submission, `/api/appointments`:

1. Validates and saves the appointment in MongoDB.
2. Replaces `{name}`, `{date}`, `{time}`, and `{service}` in the WhatsApp inquiry text.
3. Generates a `wa.me` link targeting `923337109448` and returns it to the browser.
4. The browser opens WhatsApp with the inquiry prefilled; the user presses **Send** from the WhatsApp account on their device.
5. Sends the customized email subject/message to the saved email address when Gmail SMTP is configured.
6. Stores the click-to-chat URL and email delivery status on the appointment record.

WhatsApp is not sent automatically and does not require Meta credentials.

## Forgot-password behavior

1. The user selects **Forgot password?** on the login page and enters the Manager or Receptionist email.
2. `/api/auth/forgot-password` creates a cryptographically random one-time token, stores only its SHA-256 hash in `password_reset_tokens`, and emails a reset link built from `APP_URL`.
3. The link opens the login page in password-reset mode.
4. `/api/auth/reset-password` accepts the one-time token, hashes the new password using the same scrypt password scheme as login, updates the user, and invalidates outstanding reset links.
5. MongoDB's TTL index removes expired reset-token records automatically.

## MongoDB collections

The application creates/uses:

- `users`
- `appointments`
- `blacklist`
- `settings`
- `message_campaigns`
- `password_reset_tokens`

## Validation

The updated source passes TypeScript and ESLint checks in the provided workspace.

## Deployment

Use a Node.js host supporting Next.js server routes. Add the values from `.env.example` to the hosting provider's environment configuration, then run:

```bash
npm install
npm run build
npm run start
```

Do not commit production `.env.local` files. Rotate the MongoDB password, JWT secret, Gmail App Password, and default account passwords before public deployment.
