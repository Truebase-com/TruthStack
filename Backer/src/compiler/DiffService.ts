import { IR } from "./Ir";
import { Emitter } from "./Emitter";

export class DiffService 
{
	constructor(
		public readonly ir: IR.Document,
		public readonly emitter: Emitter
	) {}
}

export enum DiffKind {
	ChildrenAdded,
	ChildrenRemoved,
	ChildrenRenamed,
	InheritanceAdded,
	InheritanceRemoved,
	DeclarationAdded,
	DeclarationRemoved
}

interface DiffBase {
	readonly kind: DiffKind;
}

export type Diff =
	| ChildrenAdded
	| ChildrenRemoved
	| ChildrenRenamed
	| InheritanceAdded
	| InheritanceRemoved
	| DeclarationAdded
	| DeclarationRemoved;

export class ChildrenAdded implements DiffBase 
{
	public readonly kind = DiffKind.ChildrenAdded;

	constructor(
		public readonly base: IR.Declaration,
		public readonly child: IR.Declaration
	) {}
}

export class ChildrenRemoved implements DiffBase 
{
	public readonly kind = DiffKind.ChildrenRemoved;

	constructor(
		public readonly base: IR.Declaration,
		public readonly child: IR.Declaration
	) {}
}

export class ChildrenRenamed implements DiffBase 
{
	public readonly kind = DiffKind.ChildrenRenamed;

	constructor(
		public readonly base: IR.Declaration,
		public readonly child: IR.Declaration
	) {}
}

export class InheritanceAdded implements DiffBase 
{
	public readonly kind = DiffKind.InheritanceAdded;

	constructor(
		public readonly base: IR.Declaration,
		public readonly name: string
	) {}
}

export class InheritanceRemoved implements DiffBase 
{
	public readonly kind = DiffKind.InheritanceRemoved;

	constructor(
		public readonly base: IR.Declaration,
		public readonly name: string
	) {}
}

export class DeclarationAdded implements DiffBase 
{
	public readonly kind = DiffKind.DeclarationAdded;

	constructor(public readonly declaration: IR.Declaration) {}
}

export class DeclarationRemoved implements DiffBase 
{
	public readonly kind = DiffKind.DeclarationRemoved;

	constructor(public readonly declaration: IR.Declaration) {}
}
