
namespace Truth
{
	/**
	 * Abstract base class for all Causes defined both within
	 * the compiler core, and in user code.
	 */
	export abstract class Cause<R = void>
	{
		/**
		 * Stores the return type of the Cause, if any. In a cause callback function,
		 * this property exists as an array of objects that have been returned
		 * from other cause aids.
		 */
		readonly returns: R = null!;
	}
	
	/**
	 * Extracts the *Result* type parameter of a Cause.
	 */
	export type TCauseReturn<T> = T extends { returns: infer R } ? R : never;
	
	/**
	 * Maps a Cause type over to it's corresponding object
	 * that is fed into all cause callback functions.
	 */
	export type TCauseData<T> = {
		[P in keyof T]: P extends "returns" ?
			readonly T[P][] : 
			T[P];
	};
	
	// 
	// Causes
	// 
	
	/** */
	export class CauseAgentAttach extends Cause
	{
		constructor(
			/**
			 * Stores the URI from where the agent was loaded.
			 */
			readonly uri: KnownUri,
			/**
			 * Stores an object that represents the scope of where the agent
			 * applies.
			 * 
			 * If the value is `instanceof Program`, this indicates that
			 * the agent's causes are scoped to a particular program (which
			 * is effectively "unscoped").
			 * 
			 * If the value is `instanceof Document`, this indicates that
			 * the agent's causes are scoped to the causes that can
			 * originate from a single document.
			 * 
			 * (Not implemented). If the value is `instanceof Type`, this 
			 * indicates that the agent's causes are scoped to the causes
			 * that can originate from a single type.
			 */
			readonly scope: Program | Document | Type)
		{ super(); }
	}
	
	/** */
	export class CauseAgentDetach extends Cause
	{
		constructor(readonly uri: KnownUri) { super(); }
	}
	
	/** A cause that runs immediately after a document has been created. */
	export class CauseDocumentCreate extends Cause
	{
		constructor(readonly document: Document) { super(); }
	}
	
	/** A cause that runs immediately before a document is removed from the program. */
	export class CauseDocumentDelete extends Cause
	{
		constructor(readonly document: Document) { super(); }
	}
	
	/** A cause that runs when a document's file name changes. */
	export class CauseDocumentUriChange extends Cause
	{
		constructor(
			readonly document: Document,
			readonly newUri: KnownUri)
		{ super(); }
	}
	
	/** A cause that runs when a document edit transaction has completed. */
	export class CauseEditComplete extends Cause
	{
		constructor(readonly document: Document) { super(); }
	}
	
	/**
	 * A hook that runs when the set of faults that are detected
	 * within the document have changed.
	 */
	export class CauseFaultChange extends Cause
	{
		constructor(
			readonly faultsAdded: Fault[],
			readonly faultsRemoved: Fault[])
		{ super(); }
	}
}
