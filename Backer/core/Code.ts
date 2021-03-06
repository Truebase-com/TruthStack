
namespace Backer
{	
	/**
	 * Referances to every loaded Code instance.
	 */
	export const Codes: Code[] = [];
	
	/**
	 * Last loaded Schema
	 */
	export let Schema: Record<string, Struct> = {};
	
	/**
	 * Referances to every loaded Schema
	 */
	export const Schemas: Record<string, Struct>[] = [];
	
	/**
	 * Last loaded Data Graph
	 */
	export let Graph: Record<string, Surrogate> = {};
	
	/**
	 * Referances to every loaded Data Graph
	 */
	export const Graphs: Record<string, Surrogate>[] = [];
	
	/**
	 * Truth Code JSON
	 * 
	 * This class manages code types extracted from Truth file by compiler.
	 * Also manages relations between prototype, types and data. 
	 */
	export class Code
	{
		/**
		 * Loads a CodeJSON and loads DataJSONs on that Code instance.
		 * 
		 * @param code CodeJSON Url
		 * @param data DataJSON Urls
		 */
		static async load(code: string, ...data: string[])
		{
			const instance = Code.new(await Util.fetchJSON(code));
			
			for (const url of data)
				instance.loadData(await Util.fetchJSON(url));
			
			return instance;
		}
		
		/**
		 * Loads a Code instance from parsed Code JSON.
		 * @param data Parsed CodeJSON
		 */
		static new(data: [PrototypeJSON[], TypeJSON[]])
		{
			const code = new Code();
			
			const prototypes = data[0].map(x => Prototype.load(code, x));
			for (const proto of prototypes)
				code.prototypes.push(proto);
			
			const types = data[1].map(x => Type.load(code, x));
			for (const type of types)
			{
				const id = code.types.push(type) - 1;
				FutureType.idMap.set(id, type);
			}
			
			const schema: Record<string, Struct> = {};
			
			for (const type of types)
				if (!type.container)
					schema[type.name] = new Struct(type, null);
			
			Backer.Schema = schema;
			Schemas.push(schema);
			Codes.push(code);
			
			return code;
		}
		
		types: Type[] = [];
		prototypes: Prototype[] = [];
		
		/**
		 * Binds a type to Code instance
		 */
		add(type: Type)
		{
			if (!this.prototypes.some(x => x.hash === type.prototype.hash))
				this.prototypes.push(type.prototype);
			
			const id = this.types.push(type) - 1;
			type.transfer(this);
			return id;
		}
		
		/**
		 * Loads data types and surrogates from parsed DataJSON.
		 * @param data Parsed DataJSON
		 */
		loadData(data: DataJSON[])
		{	
			const graph: Record<string, Surrogate> = {};
			
			for (const info of data)
			{
				const prototypes = info.shift() as number[];
				const name = info.shift() as string;
				const prototype = this.prototypes[prototypes.shift()!];
				const type = new Type(
					this, 
					name, 
					prototype, 
					null,
					ValueStore.load(...info.shift() as ValueJSON[])
				);
				
				const generate = (base: Type, contents: Type[]) => 
				{
					for (const content of contents)
					{
						const clone = new Type(
							this,
							content.name,
							this.prototypes[prototypes.shift()!],
							FutureType.new(base),
							content.values.concat(ValueStore.load(...info.shift() as ValueJSON[]))
						);
						
						this.types.push(clone);
						generate(clone, clone.parallelContents);
					}
				}
				
				generate(type, type.parallelContents);
				graph[type.name] = new Surrogate(type, null);
			}
			
			Backer.Graph = graph;
			Graphs.push(graph);
			
			return graph;
		}
		
		/**
		 * Extract data from current types of Code
		 * @param pattern Data Name Pattern
		 */
		extractData(pattern: RegExp)
		{
			const dataRoots = this.types
				.filter(x => x.container === null && pattern.test(x.name));
			
			const drill = (type: Type) =>
			{
				const array = [type];
				
				for (const contentType of type.contents)
				{
					const child = drill(contentType).flat();
					if (child.length)
						array.push(...child);
				}
				
				return array;
			};
			
			const dataSchema = dataRoots
				.map(drill)
				.filter(type => Array.isArray(type) ?
					type.length : 
					true);
			
			const dataQuery = dataSchema.flat();
			
			const codeRoots = this.types
				.filter(type => !dataQuery.includes(type));
			
			const code = new Code();
			for (const type of codeRoots)
				code.add(type);
				
			for (const type of dataQuery)
			{			
				if (!code.prototypes.some(proto => proto.hash === type.prototype.hash))
					code.prototypes.push(type.prototype);
				
				type.transfer(code);
			}
			
			const data = dataSchema
				.map(types => [
					types.map(type => type.prototype.id), 
					types[0].name, 
					...types.map(type => type.values.valueStore)
				]);
			
			return {
				code,
				data
			}
		}
		
		/** */
		toJSON()
		{
			return [this.prototypes, this.types];
		}
		
		/** */
		valueOf()
		{
			return this.types.length;
		}
		
		/** */
		[Symbol.toPrimitive]()
		{
			return this.types.length;
		}
		
		/** */
		get [Symbol.toStringTag]()
		{
			return "Code";
		}
	}
}
