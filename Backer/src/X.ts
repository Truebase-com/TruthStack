import * as X from "../../Truth/Core/X";
import { outdent } from "../../Truth/CoreTests/Framework/TestUtil";
import { IR } from "./compiler/IR";
import { JSEmitter } from "./compiler/JavaScriptEmitter";

function main() 
{
	const source = outdent`
	String
	Number

	Test User
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
	
	const result = IR.parseTruth(doc);
	JSEmitter(result);
}

main();
setInterval(() => null, 1e4);