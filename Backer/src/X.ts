import * as X from "../../Truth/Core/X";
import { outdent } from "../../Truth/CoreTests/Framework/TestUtil";
import { toIR } from "./compiler/IR";

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
	
	const result = toIR(doc);
	console.log(result);
}

main();
setInterval(() => null, 1e4);