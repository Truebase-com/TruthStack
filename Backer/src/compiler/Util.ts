/**
 * Change string case to UpperCamelCase.
 * @param  {string} str The input string.
 * @returns string The input in upperCameCase
 */
export function camelize(str: string): string 
{
	return str
		.replace(/(?:^\w|[A-Z]|\b\w)/g, word => word.toUpperCase())
		.replace(/\s+/g, "");
}

/**
 * Change string case to lowerCamelCase.
 * @param  {string} str The input string.
 * @returns string The input in lowerCamelCase.
 */
export function lowerCamelize(str: string): string 
{
	return str
		.replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) =>
			index === 0 ? word.toLowerCase() : word.toUpperCase()
		)
		.replace(/\s+/g, "");
}
