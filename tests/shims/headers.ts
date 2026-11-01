// Test stand-in for next/headers: the signed-in user is whatever tests/helpers.ts set with signInAs().
const jar = new Map<string, string>();
export async function cookies() {
  return { get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined), set: (k: string, v: string) => void jar.set(k, String(v)), delete: (k: string) => void jar.delete(k) };
}
export function __setCookie(k: string, v: string | null) { if (v === null) jar.delete(k); else jar.set(k, v); }
export async function headers() { return new Map<string, string>(); }
