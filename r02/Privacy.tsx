import type { ReactNode } from "react";
import policy from "../PRIVACY.md?raw";

// PRIVACY.md uses headings, paragraphs, bullet lists and ordinary Markdown links.
function inline(text: string) {
  const nodes: ReactNode[] = [];
  let start = 0;
  for (const match of text.matchAll(/\[([^\]]+)\]\(((?:https:\/\/|mailto:)[^\s)]+)\)/g)) {
    nodes.push(text.slice(start, match.index));
    nodes.push(<a key={match.index} href={match[2]}>{match[1]}</a>);
    start = match.index + match[0].length;
  }
  nodes.push(text.slice(start));
  return nodes;
}

export function Privacy() {
  const blocks = policy.trim().split(/\r?\n\s*\r?\n/);
  return (
    <article className="card privacy-policy" aria-labelledby="privacy-title">
      {blocks.map((block, index) => {
        if (block.startsWith("# ")) {
          return <h1 id="privacy-title" tabIndex={-1} key={index}>{block.slice(2)}</h1>;
        }
        if (block.startsWith("## ")) return <h2 key={index}>{block.slice(3)}</h2>;
        if (block.startsWith("- ")) {
          return <ul key={index}>{block.slice(2).split(/\r?\n- /).map((item, i) =>
            <li key={i}>{inline(item)}</li>
          )}</ul>;
        }
        return <p key={index}>{inline(block)}</p>;
      })}
    </article>
  );
}
