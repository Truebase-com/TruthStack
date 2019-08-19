import * as X from "../../../Truth/Core/X";
import { camelize } from "./Util";

/**
 * This namespace contains all the functionalities and tools required to
 * deal with the Truth Intermediate representation.
 *
 * @internal
 */
export namespace IR {
	/**
	 * An IR document is a list of declarations that appear at the document's
	 * top level.
	 */
	export type Document = Declaration[];

	/**
	 * A data entity in an IR document.
	 */
	export type Declaration = {
		name: string;
		declarationName: string;
		topLevel: boolean;
		inheritedFrom: string[];
		children: Declaration[];
		parent?: Declaration;
	};

	export interface Representation {
		statements: X.Statement[];
		declarations: Document;
	}

	/**
	 * Used in toIR to store deceleration stack entities.
	 * @internal
	 */
	type DeclarationInfo = {
		indent: number;
		declaration: Declaration;
	};

	/**
	 * Convert a Truth document to an Internal Intermediate Representation.
	 * @param doc A Truth document.
	 * @returns The generated representation.
	 */
	export function parseTruth(doc: X.Document): Representation 
	{
		const statements: X.Statement[] = [];
		const result = new Set<Declaration>();
		let declarationStack: DeclarationInfo[] = [];

		for (const statement of doc.eachStatement()) 
		{
			statements.push(statement);

			if (statement.isWhitespace || statement.isComment || statement.isNoop)
				continue;

			const { declarations, annotations, indent } = statement;

			const name = camelize(
				X.SubjectSerializer.forExternal(declarations[0].boundary)
			);
			const inheritedFrom = annotations.map(annotation =>
				camelize(X.SubjectSerializer.forExternal(annotation.boundary))
			);

			const declaration: Declaration = {
				name,
				declarationName: name,
				topLevel: indent === 0,
				inheritedFrom,
				children: []
			};

			const declarationStackEntity = { indent, declaration };

			if (indent === 0) 
			{
				declarationStack = [declarationStackEntity];
				result.add(declaration);
				continue;
			}

			let lastDeclarationInfo: DeclarationInfo;
			do 
			{
				lastDeclarationInfo = declarationStack.pop()!;
			} while (lastDeclarationInfo.indent >= indent);

			const parent = lastDeclarationInfo.declaration;
			declarationStack.push(lastDeclarationInfo, declarationStackEntity);
			parent.children.push(declaration);
			declaration.parent = parent;
			// We return a list of declarations that will be accessible by the
			// user and that means any declaration with children or a topLevel.
			result.add(parent);
			if (parent.parent)
				parent.declarationName = parent.parent.declarationName + parent.name;
		}

		return {
			statements,
			declarations: [...result]
		};
	}
}
