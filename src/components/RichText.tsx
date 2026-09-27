import { Fragment } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

// Lightweight, dependency-free markdown-ish renderer for chat.
// Handles: paragraphs, **bold**, *italic*, `code`, ```fenced``` blocks,
// - / * bullet lists, and autolinked URLs. Links open in the OS browser via
// the Tauri opener (CSP blocks in-webview navigation, and we WANT external).
// No dangerouslySetInnerHTML — everything is real React nodes.

const URL_RE = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

function linkify(text: string, keyBase: string) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  let i = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const href = m[0];
    out.push(
      <a
        key={`${keyBase}-l${i++}`}
        href={href}
        className="chat-link"
        onClick={(e) => { e.preventDefault(); openUrl(href).catch(() => {}); }}
      >
        {href}
      </a>,
    );
    last = m.index + href.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// inline: **bold**, *italic*, `code`, + autolink on the plain runs
function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // tokenize on `code` first (so ** inside code is literal)
  const parts = text.split(/(`[^`]+`)/g);
  parts.forEach((part, pi) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      nodes.push(<code key={`${keyBase}-c${pi}`} className="chat-code-inline">{part.slice(1, -1)}</code>);
      return;
    }
    // bold / italic on the rest, then linkify the leaves
    const bi = part.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
    bi.forEach((seg, si) => {
      const kb = `${keyBase}-${pi}-${si}`;
      if (seg.startsWith("**") && seg.endsWith("**") && seg.length >= 4) {
        nodes.push(<strong key={kb}>{linkify(seg.slice(2, -2), kb)}</strong>);
      } else if (seg.startsWith("*") && seg.endsWith("*") && seg.length >= 2) {
        nodes.push(<em key={kb}>{linkify(seg.slice(1, -1), kb)}</em>);
      } else if (seg) {
        nodes.push(<Fragment key={kb}>{linkify(seg, kb)}</Fragment>);
      }
    });
  });
  return nodes;
}

export default function RichText({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  // split out fenced code blocks first
  const segments = text.split(/(```[\s\S]*?```)/g);
  segments.forEach((seg, si) => {
    if (seg.startsWith("```") && seg.endsWith("```")) {
      const inner = seg.slice(3, -3).replace(/^[a-zA-Z0-9]*\n/, ""); // drop lang tag
      blocks.push(<pre key={`f${si}`} className="chat-code-block"><code>{inner.replace(/\n$/, "")}</code></pre>);
      return;
    }
    // paragraphs / lists within this text segment
    const paras = seg.split(/\n{2,}/);
    paras.forEach((para, pi) => {
      const trimmed = para.trim();
      if (!trimmed) return;
      const lines = trimmed.split("\n");
      const isList = lines.every((l) => /^\s*[-*]\s+/.test(l)) && lines.length > 0;
      if (isList) {
        blocks.push(
          <ul key={`u${si}-${pi}`} className="chat-list">
            {lines.map((l, li) => <li key={li}>{renderInline(l.replace(/^\s*[-*]\s+/, ""), `u${si}-${pi}-${li}`)}</li>)}
          </ul>,
        );
      } else {
        // keep single newlines as <br/>
        blocks.push(
          <p key={`p${si}-${pi}`}>
            {lines.map((l, li) => (
              <Fragment key={li}>{li > 0 && <br />}{renderInline(l, `p${si}-${pi}-${li}`)}</Fragment>
            ))}
          </p>,
        );
      }
    });
  });
  return <>{blocks}</>;
}
