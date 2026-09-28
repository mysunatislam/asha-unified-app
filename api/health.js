export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    service: "NeuroBridge Asha",
    version: "1.0.0",
    cloudConfigured: !!(
      process.env.MAIRA_API_KEY && process.env.MAIRA_PROJECT_KEY
    ),
    caregiverConfigured: !!process.env.BLOB_READ_WRITE_TOKEN,
    pushConfigured: !!process.env.VAPID_PRIVATE_KEY,
  });
}
