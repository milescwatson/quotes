import type { JSONContent } from '@tiptap/vue-3'
import type { components } from '~/types/api.generated'
export type DescriptionRun = components['schemas']['QuoteDescriptionRun']
export function descriptionRuns(line: { descriptionContent?: DescriptionRun[]; snapshot: { content: { productDescription?: string | null } } }): DescriptionRun[] {
  return line.descriptionContent ?? (line.snapshot.content.productDescription ? [{ text: line.snapshot.content.productDescription }] : [])
}
export function descriptionDocument(runs: DescriptionRun[]): JSONContent {
  const content: JSONContent[] = []
  for (const run of runs) {
    const marks = (['bold', 'italic', 'underline'] as const).filter(mark => run[mark]).map(type => ({ type }))
    run.text.split('\n').forEach((text, i) => {
      if (i) content.push({ type: 'hardBreak' })
      if (text) content.push({ type: 'text', text, ...(marks.length ? { marks } : {}) })
    })
  }
  return { type: 'doc', content: [{ type: 'paragraph', content }] }
}
export function documentRuns(doc: JSONContent): DescriptionRun[] {
  const runs: DescriptionRun[] = []
  function append(text: string, node?: JSONContent) {
    if (!text) return
    const flags = Object.fromEntries((['bold', 'italic', 'underline'] as const).filter(mark => node?.marks?.some(m => m.type === mark)).map(mark => [mark, true]))
    const previous = runs.at(-1)
    if (previous && ['bold', 'italic', 'underline'].every(mark => Boolean(previous[mark as keyof DescriptionRun]) === Boolean(flags[mark]))) previous.text += text
    else runs.push({ text, ...flags })
  }
  doc.content?.forEach((paragraph, i) => {
    if (i) append('\n')
    paragraph.content?.forEach(node => append(node.type === 'hardBreak' ? '\n' : node.text ?? '', node))
  })
  return runs
}
