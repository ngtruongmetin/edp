import { Fragment, type ReactNode } from "react"

type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3; content: string }
  | { type: "paragraph"; content: string }
  | { type: "unordered-list"; items: string[] }
  | { type: "ordered-list"; items: string[] }
  | { type: "quote"; content: string }

function parseMarkdown(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n")
  const blocks: MarkdownBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index].trim()

    if (!line) {
      index += 1
      continue
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        content: heading[2],
      })
      index += 1
      continue
    }

    if (line.startsWith(">")) {
      blocks.push({ type: "quote", content: line.replace(/^>\s?/, "") })
      index += 1
      continue
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ""))
        index += 1
      }
      blocks.push({ type: "unordered-list", items })
      continue
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""))
        index += 1
      }
      blocks.push({ type: "ordered-list", items })
      continue
    }

    const paragraph: string[] = [line]
    index += 1
    while (index < lines.length) {
      const nextLine = lines[index].trim()
      if (!nextLine || /^(#{1,3})\s+|^>\s?|^[-*]\s+|^\d+\.\s+/.test(nextLine)) {
        break
      }
      paragraph.push(nextLine)
      index += 1
    }
    blocks.push({ type: "paragraph", content: paragraph.join(" ") })
  }

  return blocks
}

function renderInline(content: string): ReactNode[] {
  return content.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong>
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.82em] text-slate-700">{part.slice(1, -1)}</code>
    }

    return <Fragment key={index}>{part}</Fragment>
  })
}

export default function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="space-y-3 text-sm leading-6 text-slate-700">
      {parseMarkdown(content).map((block, index) => {
        if (block.type === "heading") {
          const Heading = block.level === 1 ? "h2" : block.level === 2 ? "h3" : "h4"
          return (
            <Heading key={index} className={block.level === 1 ? "pt-1 text-base font-semibold text-slate-900" : "pt-1 text-sm font-semibold text-slate-900"}>
              {renderInline(block.content)}
            </Heading>
          )
        }

        if (block.type === "unordered-list") {
          return <ul key={index} className="space-y-1.5 pl-5 marker:text-[#2e77df]">{block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}</ul>
        }

        if (block.type === "ordered-list") {
          return <ol key={index} className="space-y-1.5 pl-5 marker:font-semibold marker:text-[#2e77df]">{block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}</ol>
        }

        if (block.type === "quote") {
          return <blockquote key={index} className="border-l-2 border-[#2e77df] bg-blue-50/80 px-3 py-2 text-slate-600">{renderInline(block.content)}</blockquote>
        }

        return <p key={index}>{renderInline(block.content)}</p>
      })}
    </div>
  )
}
