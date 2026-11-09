/** Called by the existing authenticated cron; private API results remain uncached. */
export async function cleanupEveryday(store, now = Date.now()) {
  const keys = await store.list("asha-everyday/v1/clinics/", 5000);
  const expiredPrefixes = [];
  for (const key of keys.filter((k) => k.endsWith("/profile.json"))) {
    const profile = await store.read(key);
    if (profile && Date.parse(profile.expiresAt) <= now)
      expiredPrefixes.push(key.slice(0, -"profile.json".length));
  }
  const remove = keys.filter((k) =>
    expiredPrefixes.some((p) => k.startsWith(p)),
  );
  for (const key of keys.filter(
    (k) => k.includes("/records/") && !remove.includes(k),
  )) {
    const record = await store.read(key);
    if (record && Date.parse(record.sharedAt) < now - 30 * 86400000)
      remove.push(key);
  }
  const today = new Date(now).toISOString().slice(0, 10);
  remove.push(
    ...(await store.list("asha-everyday/limits/", 5000)).filter(
      (k) => k.split("/")[2] < today,
    ),
  );
  if (remove.length) await store.remove(remove);
  return {
    expiredClinicsRemoved: expiredPrefixes.length,
    everydayObjectsRemoved: remove.length,
  };
}
