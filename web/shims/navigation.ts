import { useContext } from "react";
import { RouterCtx } from "../router";
export class Redirect extends Error { constructor(public to: string) { super("redirect"); } }
export class NotFound extends Error {}
export function redirect(to: string): never { throw new Redirect(to); }
export function notFound(): never { throw new NotFound("not found"); }
export function useRouter() { return useContext(RouterCtx); }
export function usePathname() { return useContext(RouterCtx).path; }
