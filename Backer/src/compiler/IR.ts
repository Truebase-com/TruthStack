import * as X from "../../../Truth/Core/X";

/**
 * An internal intermediate representation used by the compiler.
 */
export type IR = IRDeclaration[];

/**
 * A data entity in the IR.
 */
export interface IRDeclaration {
	name: string;
	declarationName: string;
	topLevel: boolean;
	inheritedFrom: string[];
	children: IRDeclaration[];
	parent?: IRDeclaration;
}

/**
 * Used in toIR to store deceleration stack entities.
 * @internal
 */
type DeclarationInfo = {
	indent: number;
	declaration: IRDeclaration;
};

/**
 * Convert a Truth document to an Internal Intermediate Representation.
 * @param doc A Truth document.
 * @returns The generated representation.
 */
export function toIR(doc: X.Document): IR {
	const result = new Set<IRDeclaration>();
	let declarationStack: DeclarationInfo[] = [];

	for (const statement of doc.eachStatement()) {
		if (statement.isWhitespace || statement.isComment || statement.isNoop)
			continue;

		const { declarations, annotations, indent } = statement;

		const name = camelize(
			X.SubjectSerializer.forExternal(declarations[0].boundary)
		);
		const inheritedFrom = annotations.map(annotation =>
			camelize(X.SubjectSerializer.forExternal(annotation.boundary))
		);

		const declaration: IRDeclaration = {
			name,
			declarationName: name,
			topLevel: indent === 0,
			inheritedFrom,
			children: []
		};

		const declarationStackEntity = { indent, declaration };

		if (indent === 0) {
			declarationStack = [declarationStackEntity];
			result.add(declaration);
			continue;
		}

		let lastDeclarationInfo: DeclarationInfo;
		do {
			lastDeclarationInfo = declarationStack.pop()!;
		} while (lastDeclarationInfo.indent >= indent);

		declarationStack.push(lastDeclarationInfo, declarationStackEntity);
		lastDeclarationInfo.declaration.children.push(declaration);
		declaration.parent = lastDeclarationInfo.declaration;
		declaration.declarationName = lastDeclarationInfo.declaration.declarationName + name;
		// We return a list of declarations that will be accessible by the
		// user and that means any declaration with children or a topLevel.
		result.add(lastDeclarationInfo.declaration);
	}

	return [...result];
}

function camelize(str: string): string {
	return str
		.replace(/(?:^\w|[A-Z]|\b\w)/g, word => word.toUpperCase())
		.replace(/\s+/g, "");
}
