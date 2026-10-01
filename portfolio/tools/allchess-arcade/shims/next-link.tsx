import { forwardRef, type AnchorHTMLAttributes } from "react";
import { arcadeHref } from "../src/arcade-links";

type Href = string | { pathname?: string | null; query?: Record<string, string | number | boolean | undefined> | null; hash?: string | null };
type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: Href;
  prefetch?: boolean | null;
  replace?: boolean;
  scroll?: boolean;
  shallow?: boolean;
  locale?: string | false;
};

function hrefToString(href: Href) {
  if (typeof href === "string") return href;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(href.query ?? {})) if (value !== undefined) query.set(key, String(value));
  const search = query.toString();
  return `${href.pathname ?? ""}${search ? `?${search}` : ""}${href.hash ?? ""}`;
}

/**
 * Stand-in for `next/link`. App routes that the arcade can serve (local and bot
 * play) stay inside the bundle; every other route opens the full app in a new tab.
 */
const nextOnlyProps = ["prefetch", "replace", "scroll", "shallow", "locale"] as const;

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({ href, ...props }, ref) {
  const anchorProps: Record<string, unknown> = { ...props };
  for (const key of nextOnlyProps) delete anchorProps[key];
  const target = arcadeHref(hrefToString(href));
  return <a ref={ref} {...(anchorProps as AnchorHTMLAttributes<HTMLAnchorElement>)} href={target.href} {...(target.external ? { target: "_blank", rel: "noopener noreferrer" } : {})} />;
});

export default Link;
