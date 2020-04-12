/*
* @poppinss/module-methods-extractor
*
* (c) Harminder Virk <virk@adonisjs.com>
*
* For the full copyright and license information, please view the LICENSE
* file that was distributed with this source code.
*/

import { ScriptTarget } from 'typescript'

export type ExtractorOutput = {
  methods: { name: string, lineno: number }[],
  kind: 'class' | 'object',
}

export type ExtractorOptions = {
  filename: string,
  scriptTarget: ScriptTarget,
}
