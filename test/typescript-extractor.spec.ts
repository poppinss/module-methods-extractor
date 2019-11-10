/*
* @poppinns/module-methods-extractor
*
* (c) Harminder Virk <virk@adonisjs.com>
*
* For the full copyright and license information, please view the LICENSE
* file that was distributed with this source code.
*/

import test from 'japa'
import { join } from 'path'
import { readdirSync, readFileSync, statSync } from 'fs'
import { Extractor } from '../src/Extractor'

const BASE_PATH = join(__dirname, '..', 'fixtures/typescript')

const dirs = readdirSync(BASE_PATH).filter((file) => {
  return statSync(join(BASE_PATH, file)).isDirectory()
})

test.group('Typescript Extractor', () => {
  dirs.forEach((dir) => {
    const dirBasePath = join(BASE_PATH, dir)
    test(dir, (assert) => {
      const source = readFileSync(join(dirBasePath, 'source.ts'), 'utf-8')
      const expected = require(join(dirBasePath, 'output.json'))
      const actual = new Extractor().extract(source)
      assert.deepEqual(actual, expected)
    })
  })
})
