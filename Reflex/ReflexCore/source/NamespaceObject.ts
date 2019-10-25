
namespace Reflex.Core
{
	export type ConstructBranchFn = (...args: any[]) => IBranch;
	
	/** @internal */
	declare const Deno: any;
	
	/**
	 * 
	 */
	export type AsLibrary<T, L extends ILibrary> = 
		T &
		StaticBranchesOf<L> &
		StaticNonBranchesOf<L>;
	
	/**
	 * Creates a Reflex namespace, which is the top-level function object that
	 * holds all functions in the reflexive library.
	 * 
	 * This function creates the "content" variant of a Reflex namespace, which
	 * is the style where the namespace, when called as a function, produces
	 * visual content to display. Reflexive libraries that use this variant may
	 * use the namespace as a tagged template function, for example:
	 * ml`Literal text content`;
	 * 
	 * @param library An object that implements the ILibrary interface,
	 * from which the namespace object will be generated.
	 * 
	 * @param globalize Indicates whether the on/once/only globals should
	 * be appended to the global object (which is auto-detected from the
	 * current environment. If the ILibrary interface provided doesn't support
	 * the creation of recurrent functions, this parameter has no effect.
	 */
	export function createContentNamespace
		<T extends IContentNamespace<any, any>, L extends ILibrary>(
		library: L,
		globalize?: boolean): AsLibrary<T, L>
	{
		if (Const.debug && !library.createContent)
			throw new Error("The .createContent function must be implemented in this library.");
		
		return createNamespace(true, library, globalize);
	}
	
	/**
	 * Creates a Reflex namespace, which is the top-level function object that
	 * holds all functions in the reflexive library.
	 * 
	 * This function creates the "container" variant of a Reflex namespace, which
	 * is the style where the namespace, when called as a function, produces
	 * an abstract top-level container object.
	 * 
	 * @param library An object that implements the ILibrary interface,
	 * from which the namespace object will be generated.
	 * 
	 * @param globalize Indicates whether the on/once/only globals should
	 * be appended to the global object (which is auto-detected from the
	 * current environment. If the ILibrary interface provided doesn't support
	 * the creation of recurrent functions, this parameter has no effect.
	 */
	export function createContainerNamespace
		<T extends IContainerNamespace<any, any>, L extends ILibrary>(
		library: L,
		globalize?: boolean): AsLibrary<T, L>
	{
		if (Const.debug && !library.createContainer)
			throw new Error("The .createContainer function must be implemented in this library.");
		
		return createNamespace(false, library, globalize);
	}
	
	/**
	 * Internal namespace object creation function.
	 */
	function createNamespace<TNamespace, TLibrary extends ILibrary>(
		isContent: boolean,
		library: TLibrary,
		globalize?: boolean): AsLibrary<TNamespace, TLibrary>
	{
		RoutingLibrary.addLibrary(library);
		
		const glob: any =
			!globalize ? null :
			// Node.js
			(typeof global === "object" && typeof global.setTimeout === "function") ? global :
			// Browser / Deno
			(typeof navigator === "object" || typeof Deno === "object") ? window :
			null;
		
		// We create the on, once, and only globals in the case when we're creating
		// a namespace object for a library that supports recurrent functions.
		if (glob && library.attachRecurrent)
		{
			const createGlobal = (kind: RecurrentKind) => (
				selector: any,
				callback: RecurrentCallback<Atomics<any>>,
				...rest: any[]) =>
			{
				if (library.createRecurrent)
				{
					const customRecurrent = library.createRecurrent(kind, selector, callback, rest);
					if (customRecurrent !== undefined)
						return customRecurrent;
				}
				
				// We could parse the selector here, see if you have any on-on's,
				// if you do, call the functions to augment the return value.
				// Alternatively, we could inline the support for force arrays.
				return new Recurrent(kind, selector, callback, rest);
			};
			
			if (typeof glob.on !== "function")
				glob.on = createGlobal(RecurrentKind.on);
			
			if (typeof glob.once !== "function")
				glob.once = createGlobal(RecurrentKind.once);
			
			if (typeof glob.only !== "function")
				glob.only = createGlobal(RecurrentKind.only);
		}
		
		/** */
		const staticMembers = (() =>
		{
			const staticBranches = (() =>
			{
				const branchFns: { [key: string]: (...args: any) => any; } = {};
				
				if (library.getStaticBranches)
				{
					for (const [key, value] of Object.entries(library.getStaticBranches() || {}))
					{
						if (typeof value !== "function")
							continue;
						
						const constructBranchFn: ConstructBranchFn = value;
						branchFns[key] = constructBranchFn.length === 0 ?
							createBranchFn(constructBranchFn, key) :
							createParameticBranchFn(constructBranchFn, key);
					}
				}
				
				return branchFns;
			})();
			
			const staticNonBranches = 
				library.getStaticNonBranches ?
					library.getStaticNonBranches() || {} : {};
			
			return Object.assign({}, staticBranches, staticNonBranches);
		})();
		
		const nsFn = isContent ?
			createContentNamespaceFn(library) :
			createContainerNamespaceFn(library);
		
		const nsObj = (() =>
		{
			// In the case when there are no dynamic members, we can just
			// return the static namespace members, and avoid use of Proxies
			// all together.
			if (!library.getDynamicBranch && !library.getDynamicNonBranch)
				return <any>Object.assign(nsFn, staticMembers);
			
			// This variable stores an object that contains the members
			// that were attached to the proxy object after it's creation.
			// Currently this is only being used by ReflexML to attach
			// the "emit" function, but others may use it aswell.
			let attachedMembers: { [key: string]: any; } | null = null;
			
			return <any>new Proxy(nsFn, {
				get(target: Function, key: string)
				{
					if (typeof key !== "string")
						throw new Error("Unknown property.");
					
					if (key === "call" || key === "apply")
						throw new Error("call() and apply() are not supported.");
					
					if (key in staticMembers)
						return staticMembers[key];
					
					if (attachedMembers && key in attachedMembers)
						return attachedMembers[key];
					
					if (library.getDynamicBranch)
					{
						const branch = library.getDynamicBranch(key);
						if (branch)
							return createBranchFn(() => branch, key);
					}
					
					if (library.getDynamicNonBranch)
						return library.getDynamicNonBranch(key);
				},
				set(target: Function, p: any, value: any)
				{
					(attachedMembers || (attachedMembers = {}))[p] = value;
					return true;
				}
			});
		})();
		
		namespaceObjects.set(nsObj, library);
		return nsObj;
	}
	
	/**
	 * Returns the ILibrary instance that corresponds
	 * to the specified namespace object. This function
	 * is used for layering Reflexive libraries on top of
	 * each other, i.e., to defer the implementation of
	 * one of the ILibrary functions to another ILibrary
	 * at a lower-level.
	 * 
	 * The typings of the returned ILibrary assume that
	 * all ILibrary functions are implemented in order to
	 * avoid excessive "possibly undefined" checks.
	 */
	export function libraryOf(namespaceObject: object): Defined<ILibrary>
	{
		const lib: any = namespaceObjects.get(namespaceObject);
		
		if (Const.debug && !lib)
			throw new Error("This object does not have an associated Reflex library.");
		
		return lib;
	}
	
	/** */
	type Defined<T> = { [P in keyof T]-?: T[P] };
	
	/**
	 * Stores all created namespace objects, used to power the .libraryOf() function.
	 */
	const namespaceObjects = new WeakMap<object, ILibrary>();
	
	/**
	 * Returns whether the specified function or method
	 * refers to a branch function that was created by a
	 * reflexive library.
	 */
	export function isBranchFunction(fn: Function)
	{
		return branchFns.has(fn);
	}
	
	/** */
	const toBranchFunction = <T extends Function>(name: string, fn: T) =>
	{
		if (name)
		{
			Object.defineProperty(fn, "name", {
				value: name,
				writable: false,
				configurable: false
			});
		}
		
		branchFns.add(fn);
		return fn;
	}
	
	/** Stores the set of all branch functions created by all reflexive libraries. */
	const branchFns = new WeakSet<Function>();
	
	/**
	 * 
	 */
	const createBranchFn = (constructBranchFn: () => IBranch, name: string) =>
		toBranchFunction(name, (...atomics: Atomic[]) =>
			returnBranch(constructBranchFn(), atomics));
	
	/**
	 * 
	 */
	const createParameticBranchFn = (branchFn: (...args: any[]) => IBranch, name: string) =>
		(...constructBranchArgs: any[]) =>
			toBranchFunction(name, (...atomics: Atomic[]) =>
				returnBranch(branchFn(constructBranchArgs), atomics));
	
	/**
	 * 
	 */
	function returnBranch(branch: IBranch, atomics: any[])
	{
		new BranchMeta(branch, atomics);
		const lib = RoutingLibrary.this;
		return lib.returnBranch ?
			lib.returnBranch(branch) :
			branch;
	}
	
	/**
	 * Creates the function that exists at the top of the library,
	 * which is used for inserting textual content into the tree.
	 */
	function createContentNamespaceFn(library: ILibrary)
	{
		return (
			template: TemplateStringsArray | StatefulForce,
			...values: (IBranch | StatefulForce)[]): any =>
		{
			const array = Array.isArray(template) ?
				template :
				[template];
			
			const out: object[] = [];
			const len = array.length + values.length;
			
			const createContent = library.createContent;
			if (!createContent)
				return;
			
			// TODO: This should be optimized so that multiple
			// repeating string values don't result in the creation
			// of many ContentMeta objects.
			
			for (let i = -1; ++i < len;)
			{
				const val = i % 2 === 0 ?
					array[i / 2] :
					values[(i - 1) / 2];
				
				if (val === null || val === undefined)
					continue;
				
				if (val instanceof StatefulForce)
				{
					out.push(new Recurrent(
						RecurrentKind.on,
						val,
						now =>
						{
							const result = createContent(now);
							if (result)
								new ContentMeta(result);
							
							return result;
						}).run());
				}
				else
				{
					const prepared = createContent(val);
					if (prepared)
						out.push(prepared);
				}
			}
			
			for (const object of out)
				new ContentMeta(object);
			
			return out;
		};
	}
	
	/**
	 * Creates the function that exists at the top of the library,
	 * which is used for creating an abstract container object.
	 */
	function createContainerNamespaceFn(library: ILibrary)
	{
		const createContainer = library.createContainer;
		return createContainer ?
			createBranchFn(() => createContainer(), "") :
			() => {};
	};
}
