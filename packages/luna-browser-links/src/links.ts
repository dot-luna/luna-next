/** Route only HTTP(S) links from exact installed app origins to external origins. */
export function externalLink({
  source,
  destination,
  appOrigins,
  origins,
}: {
  source: string;
  destination: string;
  appOrigins: string[];
  origins: string[];
}): boolean {
  try {
    const from = new URL(source);
    const to = new URL(destination);
    return (
      appOrigins.includes(from.origin) &&
      /^https?:$/u.test(to.protocol) &&
      !to.username &&
      !to.password &&
      !origins.includes(to.origin)
    );
  } catch {
    return false;
  }
}
