import { Placeholder } from "./Placeholder";

export type WriterCallback = {
	write(data: string, position: number): void;
	truncate(length: number): void;
};

type InsertedIdentifier = {
	identifier: Placeholder;
	start: number;
	end: number;
	length: number;
};

export class Writer 
{
	private data = "";
	private cursor = 0;
	private identifiers: InsertedIdentifier[] = [];
	// Data for transactions.
	private inTransaction = false;
	private changeStart = Infinity;
	private changeEnd = 0;
	private maxChangedBytes = 0;

	constructor(
		private readonly callbacks: WriterCallback,
		private readonly smallDataSize = 10240,
		private readonly verySmallDataSize = 512
	) {}

	protected write(data: string, position: number, changed: number): void 
	{
		if (this.inTransaction) 
		{
			const end = position + changed;
			if (position < this.changeStart) this.changeStart = position;
			if (end > this.changeEnd) this.changeEnd = end;
			if (changed > this.maxChangedBytes) this.maxChangedBytes = changed;
			return;
		}
		this.callbacks.write(data, position);
	}

	protected truncate(length: number): void 
	{
		if (this.inTransaction) return;
		this.callbacks.truncate(length);
	}

	transaction(cb: (writer: Writer) => void): boolean 
	{
		if (this.inTransaction) 
		{
			cb(this);
			return true;
		}

		const originalData = this.data;
		const originalCursor = this.cursor;
		const originalIdentifiers = [...this.identifiers.map(i => ({ ...i }))];
		let changeStart: number;
		let changeEnd: number;
		let maxWriteLength: number;

		try 
		{
			this.inTransaction = true;
			cb(this);
			changeStart = this.changeStart;
			changeEnd = this.changeEnd;
			maxWriteLength = this.maxChangedBytes;
		}
		catch (e) 
		{
			this.data = originalData;
			this.cursor = originalCursor;
			this.identifiers = originalIdentifiers;
			throw e;
		}
		finally 
		{
			this.inTransaction = false;
			this.changeStart = Infinity;
			this.changeEnd = 0;
			this.maxChangedBytes = 0;
		}

		// The transaction is finished and now it's time to do the writes to the data.

		// If no action was performed just return.
		if (changeStart === Infinity || maxWriteLength === 0) return true;

		// Just for variable localization.
		const data = this.data;

		// If the new data is small just write it at once.
		if (data.length <= this.smallDataSize) 
		{
			// For a small data we just check if they're equal.
			if (data === originalData) return true;

			this.callbacks.write(data, 0);
			// Truncate the file if it's needed.
			if (data.length < originalData.length)
				this.callbacks.truncate(data.length);
			return true;
		}

		// If the change was small just write it in on syscall.
		if (
			originalData.length === data.length &&
			changeEnd - changeStart <= this.smallDataSize
		) 
		{
			this.callbacks.write(data.slice(changeStart, changeEnd), changeStart);
			return true;
		}

		// Just new text was added at the end.
		if (changeStart >= originalData.length) 
		{
			this.callbacks.write(data.slice(changeStart), changeStart);
			return true;
		}

		const start = Math.min(changeStart, originalData.length, data.length);
		const end = Math.min(changeEnd, originalData.length, data.length);
		// Store details of the last `write()` that had to be performed.
		// So we can combine two writes that touch a very small amount of data.
		let lastWriteStart: number | undefined;
		let lastWriteEnd: number | undefined;

		for (let i = start; i < end; ++i) 
		{
			if (originalData[i] === data[i]) continue;
			const start = i++;
			// There is no need to check `i < changeEnd`.
			while (originalData[i] !== data[i]) i++;
			// now: i === end;

			if (lastWriteStart === undefined) 
			{
				lastWriteStart = start;
				lastWriteEnd = i;
				continue;
			}

			if (i - lastWriteStart <= this.verySmallDataSize) 
			{
				lastWriteEnd = i;
				continue;
			}

			// Perform the last write.
			this.callbacks.write(
				data.slice(lastWriteStart, lastWriteEnd),
				lastWriteStart
			);

			// Set the current write as a pending task.
			lastWriteStart = start;
			lastWriteEnd = i;
		}

		// If there is any pending write, do it.
		if (lastWriteStart !== undefined) 
		{
			this.callbacks.write(
				data.slice(lastWriteStart, lastWriteEnd),
				lastWriteStart
			);
		}

		if (
			originalData.length < data.length &&
			(lastWriteEnd && lastWriteEnd < data.length)
		) 
		{
			this.callbacks.write(
				data.slice(originalData.length),
				originalData.length
			);
		}

		if (originalData.length > data.length) 
		{
			this.callbacks.truncate(data.length);
		}

		return true;
	}

	private updateIdentifiers(position: number, insertedChars: number): void 
	{
		for (const identifier of this.identifiers) 
		{
			// if (identifier.start > position && position <= identifier.end) {
			// 	throw new Error("Writer: Cannot write in middle of an identifier.");
			// }

			if (identifier.start > position) 
			{
				identifier.start += insertedChars;
				identifier.end += insertedChars;
			}
		}
	}

	insert(data: string, position = this.cursor): void 
	{
		this.updateIdentifiers(position, data.length);
		const writeData = data + this.data.slice(position);
		this.write(writeData, position, data.length);
		this.data = this.data.slice(0, position) + writeData;
		this.cursor += data.length;
	}

	update(data: string, length: number, position: number): void 
	{
		const changedBytes = data.length - length;
		this.updateIdentifiers(position, changedBytes);

		const updatedData = data + this.data.slice(position + length);
		this.data = this.data.slice(0, position) + updatedData;

		if (data.length === length) 
		{
			this.write(data, position, length);
			return;
		}

		this.write(updatedData, position, length);
		this.cursor += changedBytes;

		// Truncate the file if it's necessary.
		if (changedBytes < 0) 
		{
			this.truncate(this.data.length);
		}
	}

	insertIdentifier(identifier: Placeholder, position = this.cursor): void 
	{
		// Write the normal text.
		this.insert(identifier.getText(), position);
		// Push the identifier to the list.
		const start = position;
		const length = identifier.getText().length;
		const end = position + length;
		this.identifiers.push({ identifier, start, end, length });
		if (position !== this.cursor) 
		{
			this.identifiers.sort((a, b) => a.start - b.start);
		}
		identifier.addWriter(this);
	}

	applyIdentifierUpdate(identifier: Placeholder): void 
	{
		const identifiers = this.identifiers.filter(
			item => item.identifier === identifier
		);

		if (identifiers.length === 0) return;

		const name = identifier.getText();
		const length = name.length;

		const update = () => 
		{
			for (const item of identifiers) 
			{
				this.update(name, item.length, item.start);
				item.length = length;
			}
		};

		if (length === identifiers[0].length || identifiers.length === 1) 
		{
			update();
			return;
		}

		this.transaction(update);
	}
}
