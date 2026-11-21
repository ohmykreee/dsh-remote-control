/**
 * Access token handed to this console over the live socket.
 *
 * Disconnecting one device while access verification is on rotates the pairing
 * token, which invalidates the `dsh_rc` cookie of every console. The Host pushes
 * the replacement to the consoles that are still connected, and this module
 * keeps it for two purposes: the next `/ws` handshake can present `?token=`
 * before the refreshed cookie is in place, and a reload keeps working through
 * the cookie once the refresh below has landed.
 *
 * The value stays in memory; it is never written to storage or the address bar.
 */
let current: string | null = null;

/** Token to append to the next socket handshake, or null while paired by cookie. */
export function sessionToken(): string | null {
  return current;
}

/** Adopt a pushed token and replace the stale pairing cookie without a reload. */
export function applySessionToken(value: unknown): void {
  if (typeof value !== 'string' || !value) return;
  const changed = value !== current;
  current = value;
  if (changed) void refreshCookie();
}

/** Retry the cookie refresh after a reconnect, in case the last attempt failed. */
export function retrySessionCookie(): void {
  if (current) void refreshCookie();
}

/**
 * `HEAD /` is the smallest authorized static response and carries the same
 * `Set-Cookie` as the pairing page, so the rotated token replaces the old one
 * in the HttpOnly cookie. Failure is harmless: the in-memory token still
 * authorizes the next socket handshake.
 */
async function refreshCookie(): Promise<void> {
  const value = current;
  if (!value) return;
  try {
    await fetch(`/?token=${encodeURIComponent(value)}`, {
      method: 'HEAD',
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch {
    /* ignored; retried on the next `open` */
  }
}
