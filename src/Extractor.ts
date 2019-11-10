/*
* @poppinss/module-methods-extractor
*
* (c) Harminder Virk <virk@adonisjs.com>
*
* For the full copyright and license information, please view the LICENSE
* file that was distributed with this source code.
*/

import Debug from 'debug'
import ts from 'typescript'
import QuickLRU from 'quick-lru'
import { ExtractorOutput, ExtractorOptions } from './contracts'
const debug = Debug('module-methods-extractor:js')

/**
 * Exposes the API to extract methods from a Typescript or Javascript module.
 *
 * - Only export statement classes and object literals are entertained.
 * - Only top level object literals and classes are entertained.
 * - Named exports are not supported.
 */
export class Extractor {
  private _cache: QuickLRU<string, ExtractorOutput | null> = new QuickLRU({ maxSize: 1000 })

  /**
   * Returns the expression next to `module.exports` or `exports` or null if
   * unable to find both
   */
  private _findCommonJsExportExpression (node: ts.Statement): null | ts.Expression {
    if (!ts.isExpressionStatement(node) || !ts.isBinaryExpression(node.expression)) {
      return null
    }

    /**
     * Following is a module.exports statement
     */
    if (
      ts.isPropertyAccessExpression(node.expression.left) &&
      ts.isIdentifier(node.expression.left.expression) &&
      node.expression.left.expression.text === 'module' &&
      ts.isIdentifier(node.expression.left.name) &&
      node.expression.left.name.text === 'exports'
    ) {
      debug('located module.exports "%s"', node.expression.right.kind)
      return node.expression.right
    }

    /**
     * Following is an exports statement
     */
    if (
      ts.isIdentifier(node.expression.left) &&
      node.expression.left.text === 'exports'
    ) {
      debug('located exports "%s"', node.expression.right.kind)
      return node.expression.right
    }

    return null
  }

  /**
   * Returns the expression next to commonjs or esm default export. Esm
   * named exports are not entertained, since AdonisJs IoC container
   * bindings doesn't allow them as well.
   */
  private _getExportExpression (source: ts.SourceFile): ts.Expression | ts.ClassDeclaration | null {
    let expression: ts.Expression | null = null

    /**
     * Return export defaults right away
     */
    if (source['externalModuleIndicator']) {
      debug('located default export "%s"', source['externalModuleIndicator'].kind)
      return source['externalModuleIndicator'] as (ts.Expression | ts.ClassDeclaration)
    }

    /**
     * Look for commonJs style module.exports and exports
     */
    for (let statement of source.statements) {
      expression = this._findCommonJsExportExpression(statement)
      if (expression) {
        break
      }
    }

    return expression
  }

  /**
   * Creates a Typescript source file, null is returned when we are unable
   * to process the file.
   */
  private _createSourceFile (contents: string, options: ExtractorOptions): ts.SourceFile | null {
    try {
      return ts.createSourceFile(options.filename, contents, options.scriptTarget)
    } catch (error) {
      return null
    }
  }

  /**
   * Normalizes user options
  */
  private _normalizeOptions (options?: Partial<ExtractorOptions>): ExtractorOptions {
    return Object.assign({
      filename: 'anonymous',
      scriptTarget: ts.ScriptTarget.ES2018,
    }, options)
  }

  private _isPublicMethod (expression: ts.MethodDeclaration): boolean {
    if (!expression.modifiers) {
      return true
    }

    return !expression.modifiers.find((modifier) => {
      return (
        modifier.kind === ts.SyntaxKind.PrivateKeyword ||
        modifier.kind === ts.SyntaxKind.ProtectedKeyword
      )
    })
  }

  /**
   * Extracts public methods from the class declaration or class expression
   */
  private _extractClassMethods (
    sourceFile: ts.SourceFile,
    expression: ts.ClassDeclaration | ts.ClassExpression,
  ): ExtractorOutput['methods'] {
    return expression.members.filter((member) => {
      return ts.isMethodDeclaration(member)
        && member.name
        && ts.isIdentifier(member.name)
        && this._isPublicMethod(member)
    }).map((member: ts.MethodDeclaration) => {
      return {
        name: (member.name as ts.Identifier).text,
        lineno: sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile)).line + 1,
      }
    })
  }

  /**
   * Extracts methods from object literal
   */
  private _extractObjectLiteralMethods (
    sourceFile: ts.SourceFile,
    expression: ts.ObjectLiteralExpression,
  ): ExtractorOutput['methods'] {
    return expression.properties.filter((member) => {
      return ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)
    }).map((member) => {
      return {
        name: (member.name as ts.Identifier).text,
        lineno: sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile)).line + 1,
      }
    })
  }

  /**
   * Resolves the identifier by name by scanning all the top level statements
   * whose name matches the given identifier name
   */
  private _resolveIdentifier (
    sourceFile: ts.SourceFile,
    identifier: string,
  ): ts.Expression | ts.ClassDeclaration | null {
    for (let child of sourceFile.statements) {
      if (ts.isClassDeclaration(child) && child.name && child.name.text === identifier) {
        return child
        break
      }

      if (ts.isVariableStatement(child)) {
        const matchingDeclaration = child.declarationList.declarations.find((declaration) => {
          return ts.isIdentifier(declaration.name) && declaration.name.text === identifier
        })

        if (matchingDeclaration) {
          return matchingDeclaration.initializer || null
          break
        }
      }
    }

    return null
  }

  /**
   * This method loops over the BinaryExpression nodes until
   * it finds a different expression.
   *
   * The recursive attempts are made for 3 levels deep binary expression
   * and after that `null` is returned.
   *
   * This is required, when a multiple assignments are done in a single expression.
   * For example:
   *
   * ```js
   * module.exports = exports = noop = UserController
   * ```
   *
   * We need to get `UserController` by recursively parsing the BinaryExpression
   */
  private _findBinaryExpressionBranch (
    expression: ts.BinaryExpression,
    level = 0,
  ): ts.Expression | null {
    if (level === 3) {
      return null
    }

    if (ts.isBinaryExpression(expression.right)) {
      return this._findBinaryExpressionBranch(expression.right, level++)
    }

    return expression.right
  }

  /**
   * Returns an array of methods inside the file source. Methods for only
   * the exported expression are returned.
   */
  public extract (source: string, options?: Partial<ExtractorOptions>): ExtractorOutput | null {
    source = source.trim()
    const normalizedOptions = this._normalizeOptions(options)

    /**
     * Return cached response when source is same
     */
    if (this._cache.has(source)) {
      return this._cache.get(source)!
    }

    /**
     * Return null when unable to parse the source file.
     */
    const sourceFile = this._createSourceFile(source, normalizedOptions)
    if (!sourceFile) {
      this._cache.set(source, null)
      return null
    }

    /**
     * Finding the export expression in top level statements
     */
    let exportExpression = this._getExportExpression(sourceFile)
    if (exportExpression && ts.isExportAssignment(exportExpression)) {
      exportExpression = exportExpression.expression
    }

    /**
     * If export exporession exists and it points to a different statement
     * in the source file, then we further resolve it
     */
    if (exportExpression && ts.isIdentifier(exportExpression)) {
      exportExpression = this._resolveIdentifier(sourceFile, exportExpression.text)
    }

    /**
     * Here we attempt to find the assignment done on the exports statement. We
     * do allow 3 level deep assignment on a single expression
     */
    if (exportExpression && ts.isBinaryExpression(exportExpression)) {
      exportExpression = this._findBinaryExpressionBranch(exportExpression)
    }

    /**
     * Return null when export expression does not exists. It means, that the
     * top level export is missing or the identifier it points to is not
     * yet defined
     */
    if (!exportExpression) {
      this._cache.set(source, null)
      return null
    }

    /**
     * Extract class method when expression itself is a class declaration or
     * class expression
     */
    if (ts.isClassExpression(exportExpression) || ts.isClassDeclaration(exportExpression)) {
      const methods = this._extractClassMethods(sourceFile, exportExpression)
      this._cache.set(source, { kind: 'class', methods })
      return { kind: 'class', methods }
    }

    /**
     * Extract object methods when it's an ObjectLiteralExpression
     */
    if (ts.isObjectLiteralExpression(exportExpression)) {
      const methods = this._extractObjectLiteralMethods(sourceFile, exportExpression)
      this._cache.set(source, { kind: 'object', methods })
      return { kind: 'object', methods }
    }

    return null
  }
}
