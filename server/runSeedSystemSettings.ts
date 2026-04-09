import { seedSystemSettings } from "./seedSystemSettings";

seedSystemSettings().catch((e) => {
  console.error("[Seed] system_settings seed failed:", e);
  process.exit(1);
});
