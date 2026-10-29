import { useContext } from "react";
import { RouterCtx } from "../router";
export default function Link({ href, children, ...rest }: { href: string; children?: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const r = useContext(RouterCtx);
  return <a href={href} {...rest} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); r.push(href); }}>{children}</a>;
}
