// Verifies Cloudflare Access's login token on requests to the admin Worker.
//
// Cloudflare Access sits in front of the admin Worker and only lets in signed-in staff. Each request it
// lets through carries a signed token (the Cf-Access-Jwt-Assertion header). We check that token too, so
// the admin stays closed even if Access were switched off or the Worker reached another way.
// https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/

interface Jwk extends JsonWebKey { kid: string }

const keyCache = new Map<string, { keys: Map<string, CryptoKey>; fetched: number }>();

async function signingKeys(teamDomain: string): Promise<Map<string, CryptoKey>> {
  const cached = keyCache.get(teamDomain);
  if (cached && Date.now() - cached.fetched < 60 * 60 * 1000) return cached.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certificates: HTTP ${res.status}`);
  const { keys } = (await res.json()) as { keys: Jwk[] };
  const map = new Map<string, CryptoKey>();
  for (const jwk of keys) {
    map.set(jwk.kid, await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  keyCache.set(teamDomain, { keys: map, fetched: Date.now() });
  return map;
}

const b64urlToBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const b64urlToJson = (s: string) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

/** Returns the signed-in staff member's email, or null if the token is missing or not valid. */
export async function accessEmail(token: string | null, teamDomain: string, audience: string): Promise<string | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = b64urlToJson(parts[0]) as { alg: string; kid: string };
    const claims = b64urlToJson(parts[1]) as { aud: string | string[]; exp: number; nbf?: number; iss: string; email?: string };
    if (header.alg !== 'RS256') return null;
    const key = (await signingKeys(teamDomain)).get(header.kid);
    if (!key) return null;
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const now = Math.floor(Date.now() / 1000);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(audience) || claims.exp < now || (claims.nbf ?? 0) > now + 60) return null;
    if (claims.iss !== `https://${teamDomain}`) return null;
    return claims.email ?? null;
  } catch {
    return null;
  }
}
