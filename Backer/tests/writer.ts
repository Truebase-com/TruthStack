import { test, assertEqual } from "liltest";
import { Writer } from "../src/writer/Writer";
import { Placeholder } from "../src/writer/Placeholder";

class MockFile {
	public writeCount = 0;
	public truncateCount = 0;

	constructor(public data: string = "") {}

	write(data: string, offset: number): void {
		this.writeCount += 1;
		this.data =
			this.data.slice(0, offset) + data + this.data.slice(offset + data.length);
	}

	truncate(length: number): void {
		this.truncateCount += 1;
		if (length > this.data.length) throw new Error("Not implemented.");
		this.data = this.data.slice(0, length);
	}

	reset(): void {
		this.writeCount = 0;
		this.truncateCount = 0;
	}
}

test(function writerInsert() {
	const file = new MockFile();
	const writer = new Writer(file);

	writer.insert("012");
	assertEqual(file.data, "012");

	writer.insert("678");
	assertEqual(file.data, "012678");

	writer.insert("345", 3);
	assertEqual(file.data, "012345678");
});

test(function writerUpdate() {
	const file = new MockFile();
	const writer = new Writer(file);

	writer.insert("0126789");
	assertEqual(file.data, "0126789");

	writer.update("3467", 4, 3);
	assertEqual(file.data, "0123467");

	writer.update("5", 2, 5);
	assertEqual(file.data, "012345");
});

test(function writerIdentifer() {
	const file = new MockFile();
	const writer = new Writer(file);

	const middle = " is name of a planet orbiting around the ";
	const fmt = (planet: string, star: string) => planet + middle + star;

	const planet = new Placeholder("Earth");
	const star = new Placeholder("Sun");

	writer.insertIdentifier(planet);
	writer.insert(middle);
	writer.insertIdentifier(star);

	assertEqual(file.data, fmt("Earth", "Sun"));

	planet.edit("Krypton");
	assertEqual(file.data, fmt("Krypton", "Sun"));

	star.edit("Rao");
	assertEqual(file.data, fmt("Krypton", "Rao"));

	star.edit("Krypton");
	star.edit("Rao");
	assertEqual(file.data, fmt("Krypton", "Rao"));

	writer.insert("As you may know ", 0);
	assertEqual(file.data, "As you may know " + fmt("Krypton", "Rao"));

	writer.update("Hello!", 15, 0);
	assertEqual(file.data, "Hello! " + fmt("Krypton", "Rao"));
});

test(function writerTransactions() {
	const file = new MockFile();
	let writer = new Writer(file, 0, 0);

	writer.transaction(writer => {
		writer.insert("Hello");
		writer.insert(" World!");
	});

	assertEqual(file.data, "Hello World!");
	assertEqual(file.writeCount, 1);
	assertEqual(file.truncateCount, 0);
	file.reset();

	writer.transaction(writer => {
		writer.update("Hp", 5, 0);
		writer.insert("Foo, ", 0);
		writer.insert(" Bye!");
	});

	assertEqual(file.data, "Foo, Hp World! Bye!");
	assertEqual(file.writeCount, 1);
	assertEqual(file.truncateCount, 0);
	file.reset();

	writer.transaction(writer => {
		writer.update("Hi", 2, 5);
	});

	assertEqual(file.data, "Foo, Hi World! Bye!");
	assertEqual(file.writeCount, 1);
	assertEqual(file.truncateCount, 0);
	file.reset();

	writer.transaction(writer => {
		writer.update("", 5, 14);
	});

	assertEqual(file.data, "Foo, Hi World!");
	assertEqual(file.writeCount, 0);
	assertEqual(file.truncateCount, 1);
	file.reset();

	// Flush the file.
	file.data = "";
	writer = new Writer(file, 0, 0);
	writer.insert("Hello World!");

	file.reset();
	writer.transaction(() => {
		writer.insert("ABCD ", 6);
		writer.update("", 6, 0);
	});

	assertEqual(file.data, "ABCD World!");
	assertEqual(file.writeCount, 1);
	assertEqual(file.truncateCount, 1);
});

test(function writerTransactions2() {
	const file = new MockFile();
	const writer = new Writer(file, 0, 0);
	writer.insert("Hello World!");

	writer.transaction(() => {
		writer.insert("ABCD ", 6);
		writer.update("", 6, 0);
	});

	console.log(file.data);
});
