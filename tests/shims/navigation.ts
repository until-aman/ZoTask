export class Redirect extends Error { constructor(public to: string) { super(`redirect:${to}`); } }
export function redirect(to: string): never { throw new Redirect(to); }
export function notFound(): never { throw new Error("notFound"); }
