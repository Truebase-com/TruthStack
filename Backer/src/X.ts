import * as X from "../../Truth/Core/X";
import { outdent } from "../../Truth/CoreTests/Framework/TestUtil";
import { IR } from "./compiler/Ir";
import { JSEmitter } from "./compiler/JavaScriptEmitter";
import { Writer } from "./writer/Writer";
import * as fs from "fs";
import { Placeholder } from "./writer/Placeholder";

function main() 
{
	const source = outdent`
	String
	Number

	User
		Name: String
		Age: Number

	Item
		Name: String
		Width: Number
		Height: Number

	Product: Item
		Price: Number
		Stats:
			week: Number
			today: Number
	`;

	const prog = new X.Program();
	const doc = prog.documents.create(source);

	const path = __dirname + "/file.txt";
	const fd = fs.openSync(path, "w+");

	const writer = new Writer({
		write(data, position) 
		{
			console.log(position, data);
			fs.writeSync(fd, data, position, "utf-8");
		},
		truncate(length) 
		{
			fs.truncateSync(path, length);
		}
	});

	const id1 = new Placeholder("World");
	const id2 = new Placeholder("XXX");

	writer.insert("Hllo ");
	writer.insert("e", 1);
	writer.insertIdentifier(id1);
	writer.insert("!\n");

	writer.insertIdentifier(id2);

	id1.edit("Parsa");
}

main();
