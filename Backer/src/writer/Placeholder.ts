import { Writer } from "./Writer";

export class Placeholder 
{
	private text: string;
	private readonly writers: Set<Writer> = new Set();

	constructor(text: string) 
	{
		this.text = text;
	}

	getText(): string 
	{
		return this.text;
	}

	edit(newText: string): void 
	{
		if (this.text === newText) return;

		this.text = newText;
		for (const writer of this.writers) 
		{
			writer.applyIdentifierUpdate(this);
		}
	}

	addWriter(writer: Writer): void 
	{
		this.writers.add(writer);
	}
}
