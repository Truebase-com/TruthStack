import PrimeType from "./Type";
import { Type, read, RegexCharRange } from "../../../Truth/Core/X";
import { promises as FS } from "fs";
import Serializer from "./Serializer";
import { typeHash } from "./Util";
import { FuturePrimeType } from "./FutureType";
 
/**
 * Builds and emits Code JSON file
 */
export default class CodeJSON 
{
	/**
	 * 
	 */
	constructor(protected types: PrimeType[] = []) {	}
	
	primeId(type: PrimeType)
	{
		return this.types.indexOf(type);
	}	
	
	add(prime: PrimeType)
	{
		const id = this.types.push(prime) - 1;
		FuturePrimeType.set(id, prime);
		return prime;
	}
	
	/**
	 * 
	 */
	async loadFile(path: string)
	{
		try 
		{
			const file = await FS.readFile(path, "utf-8");
			if (file.trim().length === 0) return;
			const json = JSON.parse(file);
			const array = json.map((x: [number] & any[]) => Serializer.decode(x, PrimeType.JSONLength));
			const primes: PrimeType[] = [];
			for (const data of array)
			{
				const prime = PrimeType.fromJSON(this, data);
				this.add(prime);
				primes.push(prime);
			}
			
			for (const prime of primes)
				prime.link();
		} 
		catch (ex) {
			console.error(`Couldn't load ${path}! Reason: ${ex}`);	
		}
	}

	async loadTruth(path: string)
	{	
		const Doc = await read(path);
		 
		if (Doc instanceof Error)
			return console.error(`Couldn't load truth file ${path}! Reason: ${Doc.message}`);
			
		const primes: PrimeType[] = [];
			
		const scanContent = (type: Type) =>
		{
			if (!PrimeType.SignatureMap.has(typeHash(type)))
			{
				const prime = PrimeType.fromType(this, type);
				this.add(prime);
				primes.push(prime);
			}
			type.contents.forEach(x => scanContent(x));
		}	
		
		Doc.program.verify();
		
		for (const fault of Doc.program.faults.each())
			console.error(fault.toString());
		
		Doc.types.forEach(x => scanContent(x));
		
		for (const prime of primes)
			prime.link();
	}	
	
	filter(pattern: RegExp)
	{
		return this.types.filter(x => x.container.id === -1 && pattern.test(x.name));
	}
	
	/**
	 * 
	 */
	toJSON()
	{
		return this.types.filter(x => x.visible);
	}
}
