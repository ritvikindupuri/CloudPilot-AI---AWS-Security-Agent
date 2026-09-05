import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

/** Block javascript:/data: URL schemes and force safe link attributes. */
function safeUrlTransform(url: string): string {
  const trimmed = (url || "").trim();
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("vbscript:") ||
    lower.startsWith("data:text/html")
  ) {
    return "#";
  }
  return trimmed;
}

const components: Components = {
  a: ({ href, children, ...props }) => (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
    >
      {children}
    </a>
  ),
};

interface SafeMarkdownProps {
  children: string;
  className?: string;
}

/** Renders untrusted model/user markdown without raw HTML and with URL hardening. */
export default function SafeMarkdown({ children, className }: SafeMarkdownProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={safeUrlTransform}
        skipHtml
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
