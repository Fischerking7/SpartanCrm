import { db } from "./db";
import { users, providers, clients, services } from "@shared/schema";
import bcrypt from "bcryptjs";

async function seed() {
  console.log("Seeding database...");

  // Check if admin already exists
  const existingAdmin = await db.query.users.findFirst({
    where: (users, { eq }) => eq(users.repId, "admin"),
  });

  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash("admin123", 10);
    await db.insert(users).values({
      name: "System Administrator",
      repId: "admin",
      role: "ADMIN",
      status: "ACTIVE",
      passwordHash,
    });
    console.log("Created admin user: repId=admin, password=admin123");
  } else {
    console.log("Admin user already exists");
  }

  // Seed some providers
  const existingProviders = await db.query.providers.findMany();
  if (existingProviders.length === 0) {
    await db.insert(providers).values([
      { name: "Comcast", active: true },
      { name: "AT&T", active: true },
      { name: "Verizon", active: true },
    ]);
    console.log("Created sample providers");
  }

  // Seed some clients
  const existingClients = await db.query.clients.findMany();
  if (existingClients.length === 0) {
    await db.insert(clients).values([
      { name: "Retail Partner A", active: true },
      { name: "Corporate Sales", active: true },
      { name: "Online Channel", active: true },
    ]);
    console.log("Created sample clients");
  }

  // Seed some services
  const existingServices = await db.query.services.findMany();
  if (existingServices.length === 0) {
    await db.insert(services).values([
      { code: "INTERNET", name: "Internet Service", category: "Connectivity", active: true },
      { code: "TV", name: "Television Package", category: "Entertainment", active: true },
      { code: "MOBILE", name: "Mobile Line", category: "Wireless", active: true },
      { code: "BUNDLE", name: "Triple Play Bundle", category: "Bundle", active: true },
    ]);
    console.log("Created sample services");
  }

  console.log("Seeding complete!");
}

seed().catch(console.error);
