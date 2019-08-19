import { IR } from "./Ir";
import { Writer } from "../writer/Writer";
import * as D from "./DiffService";

export abstract class Emitter 
{
	constructor(
		public readonly ir: IR.Document,
		public readonly writer: Writer
	) {}

	abstract [D.DiffKind.ChildrenAdded](diff: D.ChildrenAdded): void;

	abstract [D.DiffKind.ChildrenRemoved](diff: D.ChildrenRemoved): void;

	abstract [D.DiffKind.ChildrenRenamed](diff: D.ChildrenRenamed): void;

	abstract [D.DiffKind.InheritanceAdded](diff: D.InheritanceAdded): void;

	abstract [D.DiffKind.InheritanceRemoved](diff: D.InheritanceRemoved): void;

	abstract [D.DiffKind.DeclarationAdded](diff: D.DeclarationAdded): void;

	abstract [D.DiffKind.DeclarationRemoved](diff: D.DeclarationRemoved): void;
}
