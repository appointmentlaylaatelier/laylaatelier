import { randomUUID } from "node:crypto";
import { getDb } from "./mongodb";
import { hashPassword, type Role } from "./auth";

let bootstrapPromise: Promise<void> | null = null;

async function upsertUser(email: string | undefined, password: string | undefined, name: string, role: Role) {
  if (!email || !password) return;
  const db = await getDb();
  const users = db.collection("users");
  const normalizedEmail = email.toLowerCase();
  const existing = await users.findOne({ email: normalizedEmail });
  if (existing) {
    await users.updateOne({ email: normalizedEmail }, { $set: { name, role, updatedAt: new Date() } });
    return;
  }
  const { salt, hash } = hashPassword(password);
  await users.insertOne({
    id: randomUUID(),
    name,
    email: normalizedEmail,
    role,
    passwordSalt: salt,
    passwordHash: hash,
    createdAt: new Date(),
  });
}

export async function ensureBootstrap() {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const db = await getDb();
      const appointments = db.collection("appointments");

      await appointments.createIndex({ date: 1 });
      const appointmentIndexes = await appointments.indexes();
      for (const index of appointmentIndexes) {
        const isUniquePhoneIndex = index.unique === true
          && Object.keys(index.key).length === 1
          && index.key.phone === 1
          && typeof index.name === "string";
        if (isUniquePhoneIndex) await appointments.dropIndex(index.name as string);
      }

      await Promise.all([
        db.collection("users").createIndex({ email: 1 }, { unique: true }),
        appointments.createIndex({ phone: 1 }),
        db.collection("blacklist").createIndex({ normalizedPhone: 1 }, { unique: true }),
        db.collection("message_campaigns").createIndex({ sentAt: -1 }),
        db.collection("password_reset_tokens").createIndex({ tokenHash: 1 }, { unique: true }),
        db.collection("password_reset_tokens").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      ]);
      await Promise.all([
        appointments.updateMany({ status: "Booked" }, { $set: { status: "Confirmed", updatedAt: new Date() } }),
        appointments.updateMany({ status: "Completed" }, { $set: { status: "Arrived", updatedAt: new Date() } }),
        appointments.updateMany({ placementStatus: { $exists: false } }, { $set: { placementStatus: "Not placed" } }),
        appointments.updateMany({ designerAssigned: { $exists: false } }, { $set: { designerAssigned: "" } }),
      ]);

      await upsertUser(process.env.MANAGER_EMAIL || process.env.SEED_MANAGER_EMAIL, process.env.SEED_MANAGER_PASSWORD, "Manager", "manager");
      await upsertUser(process.env.RECEPTIONIST_EMAIL || process.env.SEED_RECEPTIONIST_EMAIL, process.env.SEED_RECEPTIONIST_PASSWORD, "Receptionist", "receptionist");
    })().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }
  return bootstrapPromise;
}
