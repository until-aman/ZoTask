const jar = new Map<string, string>();
export async function cookies() {
  return { get: (k: string) => (jar.has(k) ? { value: jar.get(k)! } : undefined), set: (k: string, v: string) => { jar.set(k, v); } };
}
