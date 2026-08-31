export const COOKIE = "sth_session";

/** Token = SHA-256 of the site password + a fixed salt, so the password itself is never stored in a cookie. */
export async function tokenFor(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`trade-ledger::${password}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function sitePassword(): string {
  return process.env.SITE_PASSWORD ?? "";
}
