"use client";

/**
 * SimpleMarkdown — renderer markdown ringan & aman (tanpa dangerouslySetInnerHTML).
 * Mendukung: heading, bullet/numbered list, tabel, blok kode, **bold**, *italic*,
 * `code`, dan tautan [teks](url) dengan whitelist skema (http/https, /api/files/).
 */

import { Download } from "lucide-react";
import type { ReactNode } from "react";

function safeHref(url: string): string | null {
  if (url.startsWith("/api/files/") || url.startsWith("/tugas/")) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return null;
}

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const k = `${keyPrefix}-${i++}`;
    if (m[2] !== undefined) {
      const href = safeHref(m[3]);
      const isFile = m[3].startsWith("/api/files/");
      out.push(
        href ? (
          <a key={k} href={href} target={isFile ? undefined : "_blank"} rel="noopener noreferrer" download={isFile || undefined} className="inline-flex items-center gap-1 font-semibold text-blue-700 underline hover:text-blue-900">
            {isFile && <Download className="h-3.5 w-3.5" />}
            {m[2]}
          </a>
        ) : (
          <span key={k}>{m[2]}</span>
        ),
      );
    } else if (m[4] !== undefined) out.push(<strong key={k}>{m[4]}</strong>);
    else if (m[5] !== undefined) out.push(<code key={k} className="rounded bg-slate-200/70 px-1 py-0.5 font-mono text-[0.85em]">{m[5]}</code>);
    else if (m[6] !== undefined) out.push(<em key={k}>{m[6]}</em>);
    last = idx + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function SimpleMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const nodes: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) buf.push(lines[i++]);
      i++;
      nodes.push(<pre key={key++} className="overflow-x-auto rounded-lg bg-slate-800 p-2 text-xs text-slate-100"><code>{buf.join("\n")}</code></pre>);
      continue;
    }

    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const cls = h[1].length <= 2 ? "mt-2 text-sm font-bold" : "mt-1.5 text-sm font-semibold";
      nodes.push(<p key={key++} className={cls}>{inline(h[2], `h${key}`)}</p>);
      i++;
      continue;
    }

    if (line.trim().startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(lines[i++].trim());
      const cells = rows.filter((r) => !/^\|?\s*:?-{2,}/.test(r)).map((r) => r.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()));
      if (cells.length) {
        const [head, ...body] = cells;
        nodes.push(
          <div key={key++} className="my-1 overflow-x-auto">
            <table className="min-w-full border-collapse text-xs">
              <thead><tr>{head.map((c, ci) => <th key={ci} className="border border-slate-300 bg-slate-200/60 px-2 py-1 text-left font-semibold">{inline(c, `th${key}-${ci}`)}</th>)}</tr></thead>
              <tbody>{body.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} className="border border-slate-300 px-2 py-1 align-top">{inline(c, `td${key}-${ri}-${ci}`)}</td>)}</tr>)}</tbody>
            </table>
          </div>,
        );
      }
      continue;
    }

    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      const items: string[] = [];
      while (i < lines.length) {
        const b = /^\s*[-*•]\s+(.*)$/.exec(lines[i]);
        const n = /^\s*(\d+)[.)]\s+(.*)$/.exec(lines[i]);
        if (ordered && n) items.push(n[2]);
        else if (!ordered && b) items.push(b[1]);
        else if (items.length && /^\s{2,}\S/.test(lines[i])) items[items.length - 1] += ` ${lines[i].trim()}`;
        else break;
        i++;
      }
      const Tag = ordered ? "ol" : "ul";
      nodes.push(<Tag key={key++} className={`my-1 space-y-0.5 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>{items.map((it, ii) => <li key={ii}>{inline(it, `li${key}-${ii}`)}</li>)}</Tag>);
      continue;
    }

    if (!line.trim()) { i++; continue; }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*[-*•]\s|\s*\d+[.)]\s|\||```)/.test(lines[i])) para.push(lines[i++]);
    nodes.push(<p key={key++} className="my-1">{para.map((p, pi) => <span key={pi}>{pi > 0 && <br />}{inline(p, `p${key}-${pi}`)}</span>)}</p>);
  }

  return <div className="text-sm leading-relaxed">{nodes}</div>;
}
