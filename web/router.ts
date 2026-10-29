import { createContext } from "react";
export type Router = { path: string; push: (to: string) => void; replace: (to: string) => void; refresh: () => void };
export const RouterCtx = createContext<Router>({ path: "/", push: () => {}, replace: () => {}, refresh: () => {} });
