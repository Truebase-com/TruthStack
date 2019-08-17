import * as X from "../../../Truth/Core/X";

export class Compiler {
	constructor(readonly program: X.Program) {
		program.on(X.CauseDocumentCreate, () => {});
	}
}
