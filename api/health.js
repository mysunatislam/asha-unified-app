export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    service: "NeuroBridge Asha",
    version: "1.0.0",
    cloudConfigured: !!(
      process.env.MAIRA_API_KEY && process.env.MAIRA_PROJECT_KEY
    ),
    caregiverConfigured: !!(
      (process.env.SUPABASE_URL &&
        (process.env.SUPABASE_SECRET_KEY ||
          process.env.SUPABASE_SERVICE_ROLE_KEY)) ||
      process.env.BLOB_READ_WRITE_TOKEN
    ),
    storageProvider:
      process.env.SUPABASE_URL &&
      (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)
        ? "supabase"
        : "blob",
    pushConfigured: !!process.env.VAPID_PRIVATE_KEY,
  });
}
