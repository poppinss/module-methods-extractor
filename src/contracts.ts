import { ScriptTarget } from 'typescript'

export type ExtractorOutput = {
  methods: { name: string, lineno: number }[],
  kind: 'class' | 'object',
}

export type ExtractorOptions = {
  filename: string,
  scriptTarget: ScriptTarget,
}
