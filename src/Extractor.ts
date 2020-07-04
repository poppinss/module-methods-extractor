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
	private cache: QuickLRU<string, ExtractorOutput | null> = new QuickLRU({ maxSize: 1000 })

	/**
	 * Returns the expression next to `module.exports` or `exports` or null if
	 * unable to find both
	 */
	private findCommonJsExportExpression(node: ts.Statement): null | ts.Expression {
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
		if (ts.isIdentifier(node.expression.left) && node.expression.left.text === 'exports') {
			debug('located exports "%s"', node.expression.right.kind)
			return node.expression.right
		}

		return null
	}

	/**
	 * Finds esm export expresions
	 */
	private findEsmExportExpression(node: ts.Statement): null | ts.ClassDeclaration | ts.Expression {
		/**
		 * Export assignment expressions are returned as it is
		 */
		if (ts.isExportAssignment(node)) {
			return node.expression
		}

		/**
		 * Node is class declaration, so we need to check it's modifiers (if any)
		 * to see if it has `export default`
		 */
		if (!ts.isClassDeclaration(node) || !node.modifiers) {
			return null
		}

		/**
		 * Has export default modifier
		 */
		if (node.modifiers.find((modifier) => ts.SyntaxKind.DefaultKeyword === modifier.kind)) {
			return node
		}

		return null
	}

	/**
	 * Returns the expression next to commonjs or esm default export. Esm
	 * named exports are not entertained, since AdonisJs IoC container
	 * bindings doesn't allow them as well.
	 */
	private getExportExpression(source: ts.SourceFile): ts.Expression | ts.ClassDeclaration | null {
		let expression: ts.Expression | ts.ClassDeclaration | null = null

		/**
		 * Look for commonJs style module.exports and exports
		 */
		for (let statement of source.statements) {
			expression = this.findCommonJsExportExpression(statement) || this.findEsmExportExpression(statement)
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
	private createSourceFile(contents: string, options: ExtractorOptions): ts.SourceFile | null {
		try {
			return ts.createSourceFile(options.filename, contents, options.scriptTarget)
		} catch (error) {
			return null
		}
	}

	/**
	 * Normalizes user options
	 */
	private normalizeOptions(options?: Partial<ExtractorOptions>): ExtractorOptions {
		return Object.assign(
			{
				filename: 'anonymous',
				scriptTarget: ts.ScriptTarget.ES2018,
			},
			options
		)
	}

	private isPublicMethod(expression: ts.MethodDeclaration): boolean {
		if (!expression.modifiers) {
			return true
		}

		return !expression.modifiers.find((modifier) => {
			return modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword
		})
	}

	/**
	 * Extracts public methods from the class declaration or class expression
	 */
	private extractClassMethods(
		sourceFile: ts.SourceFile,
		expression: ts.ClassDeclaration | ts.ClassExpression
	): ExtractorOutput['methods'] {
		return expression.members
			.filter((member) => {
				return (
					ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name) && this.isPublicMethod(member)
				)
			})
			.map((member: ts.MethodDeclaration) => {
				return {
					name: (member.name as ts.Identifier).text,
					lineno: sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile)).line + 1,
				}
			})
	}

	/**
	 * Extracts methods from object literal
	 */
	private extractObjectLiteralMethods(
		sourceFile: ts.SourceFile,
		expression: ts.ObjectLiteralExpression
	): ExtractorOutput['methods'] {
		return expression.properties
			.filter((member) => {
				return ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)
			})
			.map((member) => {
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
	private resolveIdentifier(sourceFile: ts.SourceFile, identifier: string): ts.Expression | ts.ClassDeclaration | null {
		for (let child of sourceFile.statements) {
			if (ts.isClassDeclaration(child) && child.name && child.name.text === identifier) {
				return child
			}

			if (ts.isVariableStatement(child)) {
				const matchingDeclaration = child.declarationList.declarations.find((declaration) => {
					return ts.isIdentifier(declaration.name) && declaration.name.text === identifier
				})

				if (matchingDeclaration) {
					return matchingDeclaration.initializer || null
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
	private findBinaryExpressionBranch(expression: ts.BinaryExpression, level = 0): ts.Expression | null {
		if (level === 3) {
			return null
		}

		if (ts.isBinaryExpression(expression.right)) {
			return this.findBinaryExpressionBranch(expression.right, level++)
		}

		return expression.right
	}

	/**
	 * Returns an array of methods inside the file source. Methods for only
	 * the exported expression are returned.
	 */
	public extract(source: string, options?: Partial<ExtractorOptions>): ExtractorOutput | null {
		source = source.trim()
		const normalizedOptions = this.normalizeOptions(options)

		/**
		 * Return cached response when source is same
		 */
		if (this.cache.has(source)) {
			return this.cache.get(source)!
		}

		/**
		 * Return null when unable to parse the source file.
		 */
		const sourceFile = this.createSourceFile(source, normalizedOptions)
		if (!sourceFile) {
			this.cache.set(source, null)
			return null
		}

		/**
		 * Finding the export expression in top level statements
		 */
		let exportExpression = this.getExportExpression(sourceFile)
		if (exportExpression && ts.isExportAssignment(exportExpression)) {
			exportExpression = exportExpression.expression
		}

		/**
		 * If export exporession exists and it points to a different statement
		 * in the source file, then we further resolve it
		 */
		if (exportExpression && ts.isIdentifier(exportExpression)) {
			exportExpression = this.resolveIdentifier(sourceFile, exportExpression.text)
		}

		/**
		 * Here we attempt to find the assignment done on the exports statement. We
		 * do allow 3 level deep assignment on a single expression
		 */
		if (exportExpression && ts.isBinaryExpression(exportExpression)) {
			exportExpression = this.findBinaryExpressionBranch(exportExpression)
		}

		/**
		 * Return null when export expression does not exists. It means, that the
		 * top level export is missing or the identifier it points to is not
		 * yet defined
		 */
		if (!exportExpression) {
			this.cache.set(source, null)
			return null
		}

		/**
		 * Extract class method when expression itself is a class declaration or
		 * class expression
		 */
		if (ts.isClassExpression(exportExpression) || ts.isClassDeclaration(exportExpression)) {
			const methods = this.extractClassMethods(sourceFile, exportExpression)
			this.cache.set(source, { kind: 'class', methods })
			return { kind: 'class', methods }
		}

		/**
		 * Extract object methods when it's an ObjectLiteralExpression
		 */
		if (ts.isObjectLiteralExpression(exportExpression)) {
			const methods = this.extractObjectLiteralMethods(sourceFile, exportExpression)
			this.cache.set(source, { kind: 'object', methods })
			return { kind: 'object', methods }
		}

		return null
	}
}
