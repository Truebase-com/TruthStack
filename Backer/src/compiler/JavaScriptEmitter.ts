import { IR } from "./IR";
import { outdent } from "../../../Truth/CoreTests/Framework/TestUtil";

export function JSEmitter(declarations: IR.Document): void {
  let result: string = `const TruthFactory = require("truth-factory");`;

  const isSpecial = (name: string): boolean => {
    return name === "String" || name === "Number" || name === "Boolean";
  }

  const quote = (name: string): string => isSpecial(name) ? name : `"${name}"`;

  const type2str = (field: IR.Declaration): string => {
    if (field.declarationName !== field.name) {
      return quote(field.declarationName);
    }

    if (field.inheritedFrom.length === 0) {
      return "TruthFactor.any";
    }

    if (field.inheritedFrom.length === 1) {
      return quote(field.inheritedFrom[0]);
    }

    return `TruthFactory.union(${field.inheritedFrom.map(quote).join()})`;
  };

  for (const declaration of declarations) {
    if (isSpecial(declaration.name)) continue;

    const code = outdent`
    const ${declaration.declarationName} = TruthFactory(
      "${declaration.declarationName}",
      [${declaration.inheritedFrom.map(name => `"${name}"`).join()}],
      {
        ${declaration.children.map(field => field.name + ": " + type2str(field)).join(",\n        ")}
      }
    );
    `;

    result += "\n" + code;
  }

  result += `\nTruthFactory.resolve();`

  console.log(result);
}