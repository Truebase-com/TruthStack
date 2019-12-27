
namespace Truth
{
	/**
	 * A type that describes the possible objects within a document
	 * that may be responsible for the generation of a fault.
	 */
	export type TFaultSource = Statement | Span | InfixSpan;

	/**
	 * 
	 */
	export class Fault<TSource = TFaultSource>
	{
		constructor(
			/** */
			readonly type: FaultType<TSource>,
			
			/** The document object that caused the fault to be reported. */
			readonly source: TSource,
			
			/**
			 * A human-readable message that contains more in-depth detail
			 * of the fault that occured, in addition to the standard message.
			 */
			readonly additionalDetail: string = "")
		{
			const src = this.source;
			
			// The +1's are necessary in order to deal with the fact that
			// most editors are 1-based whereas the internal representation
			// of statement strings are 0-based.
			
			if (src instanceof Statement)
			{
				// The TabsAndSpaces fault is the only fault that needs a
				// special case where it has a different reporting location.
				this.range = type.code === Faults.TabsAndSpaces.code ?
					[1, src.indent + 1] :
					[src.indent + 1, src.sourceText.length + 1];
			}
			else if (src instanceof Span || src instanceof InfixSpan)
			{
				this.range = [
					src.boundary.offsetStart + 1,
					src.boundary.offsetEnd + 1
				];
			}
			else throw Exception.unknownState();
		}
		
		/**
		 * Converts this fault into a string representation,
		 * suitable for output as an error message.
		 */
		toString()
		{
			const doc = this.document;
			
			const avoidProtocols = [
				UriProtocol.internal,
				UriProtocol.none,
				UriProtocol.unknown
			];
			
			const uriText = avoidProtocols.includes(doc.sourceUri.protocol) ?
				"" : doc.sourceUri.toStoreString() + " ";
			
			const colNums = this.range.join("-");
			const colText = colNums ? ", Col " + colNums : "";
			
			return `${this.type.message} (${uriText}Line ${this.line}${colText})`;
		}
		
		/**
		 * Gets a reference to the Document in which this Fault was detected.
		 */
		get document()
		{
			return this.statement.document;
		}
		
		/**
		 * Gets a reference to the Statement in which this Fault was detected.
		 */
		get statement()
		{
			const src = this.source;
			return Not.null(
				src instanceof Statement ? src :
				src instanceof Span ? src.statement :
				src instanceof InfixSpan ? src.statement :
				null);
		}
		
		/**
		 * Gets the line number of the Statement in which this Fault was detected.
		 */
		get line()
		{
			const smt = this.statement;
			return smt.document.getLineNumber(smt) + 1;
		}
		
		/**
		 * Gets an array representing the starting and ending character offsets
		 * within the Statement in which this Fault was detected. The character
		 * offsets are 1-based (not 0-based) to comply with the behaviour of 
		 * most text editors.
		 */
		readonly range: number[];
	}

	/**
	 * 
	 */
	export class FaultType<TSource = TFaultSource>
	{
		constructor(
			/**
			 * An error code, useful for reference purposes, or display in a user interface.
			 */
			readonly code: number,
			/**
			 * A human-readable description of the fault.
			 */
			readonly message: string,
			/**
			 * 
			 */
			readonly severity: FaultSeverity)
		{
			this.message = message.trim().replace(/\s\s+/g, " ");
		}
		
		/**
		 * Creates a fault of this type.
		 */
		create(source: TSource)
		{
			return new Fault<TSource>(this, source);
		}
	}

	/**
	 * The following definitions are intentionally equivalent
	 * to the severity codes from the monaco editor.
	 */
	export const enum FaultSeverity
	{
		/** Unused. */
		hint = 1,
		
		/** Unused. */
		info = 2,
		
		/**
		 * Indicates the severity of a fault is "warning", which means that
		 * the associated object will still be processed during type analysis.
		 */
		warning = 4,
		
		/**
		 * Indicates the severity of a fault is "error", which means that
		 * the associated object will be ignored during type analysis.
		 */
		error = 8
	}

	/**
	 * Utility function for creating frozen fault instances.
	 */
	function createFault<T>(
		code: number,
		message: string,
		severity = FaultSeverity.error)
	{
		return Object.freeze(new FaultType<T>(code, message, severity));
	}

	const quantifiers = 
		`(${RegexSyntaxMisc.star}, 
		${RegexSyntaxMisc.plus},
		${RegexSyntaxDelimiter.quantifierStart}..${RegexSyntaxDelimiter.quantifierEnd})`;

	/**
	 * 
	 */
	export const Faults = Object.freeze({
		
		/** */
		*each()
		{
			const values = Object.values(Faults) as FaultType<object>[];
			
			for (const faultType of values)
				if (faultType instanceof FaultType)
					yield faultType;
		},
		
		/**
		 * @returns An object containing the FaultType instance
		 * associated with the fault with the specified code, as
		 * well as the name of the instance. In the case when the
		 * faultCode was not found, null is returned.
		 */
		nameOf(faultCode: number)
		{
			const entries = Object.entries(Faults) as [string, FaultType<object>][];
			
			for (const [name, type] of entries)
				if (type instanceof FaultType)
					if (type.code === faultCode)
						return name;
			
			return "";
		},
		
		//# Resource-related faults
		
		/** */
		UnresolvedResource: createFault<Statement>(
			100,
			"URI points to a resource that could not be resolved."),
		
		/** */
		CircularResourceReference: createFault<Statement>(
			102,
			"URI points to a resource that would cause a circular reference."),
		
		/** */
		InsecureResourceReference: createFault<Statement>(
			104,
			`Documents loaded from remote locations
			cannot reference documents stored locally.`),
		
		//# Type verification faults
		
		/** */
		UnresolvedAnnotation: createFault<Span>(
			201,
			"Unresolved annotation."),
		
		/** */
		CircularTypeReference: createFault<Span>(
			203,
			"Circular type reference detected."),
		
		/** */
		ContractViolation: createFault<Statement>(
			//! CHANGE THIS TO 204
			205,
			"Overridden types must explicitly expand the type as defined in the base."),
		
		/** */
		TypeCannotBeRefreshed: createFault<Statement>(
			206,
			`This type cannot be refreshed, because one or more base
			types are imposing a specific type contract on it. Consider
			omitting the ${Syntax.joint} operator here.`,
			FaultSeverity.warning),
		
		/** */
		IgnoredAnnotation: createFault<Span>(
			207,
			`This annotation is ignored because another annotation
			in this statement resolves to the same type.`),
		
		/** */
		IgnoredAlias: createFault<Span>(
			209,
			`Aliases (meaning annotations that are matched by patterns)
			can't be added onto types that have a contract put in place
			by a base type.`),
		
		/** */
		TypeSelfReferential: createFault<Span>(
			211,
			"Types cannot be self-referential"),
		
		//# List-related faults
		
		/** */
		AnonymousInListIntrinsic: createFault<Statement>(
			300,
			"Types contained directly by List-intrinsic types cannot be anonymous.",
			FaultSeverity.warning),
		
		/** */
		ListContractViolation: createFault<Span>(
			301,
			"The containing list cannot contain children of this type.",
			FaultSeverity.warning),
		
		/** */
		ListIntrinsicExtendingList: createFault<Span>(
			303,
			"List intrinsic types cannot extend from other lists."),
		
		/** (This is the same thing as a list dimensionality conflict) */
		ListExtrinsicExtendingNonList: createFault<Span>(
			305,
			"Lists cannot extend from non-lists."),
		
		/** */
		ListDimensionalDiscrepancyFault: createFault<Span>(
			307,
			`A union cannot be created between these two types
			because they are lists of different dimensions.`),
		
		/** */
		ListAnnotationConflict: createFault<Span>(
			309,
			`All fragments of this annotation need to have
			a list operator (${Syntax.list})`),
		
		//# Pattern-related faults
		
		/** */
		PatternInvalid: createFault<Statement>(
			400,
			"Invalid pattern."),
		
		/** */
		PatternWithoutAnnotation: createFault<Statement>(
			402,
			"Pattern has no annotations.",
			FaultSeverity.warning),
		
		/** */
		PatternCanMatchEmpty: createFault<Statement>(
			404,
			"Patterns must not be able to match an empty input."),
		
		/** */
		PatternMatchingTypesAlreadyExists: createFault<Statement>(
			406,
			`A pattern matching these types has 
			already been defined in this scope.`),
		
		/** */
		PatternMatchingList: createFault<Span>(
			407,
			"A pattern cannot match a list type."),
		
		/** */
		PatternCanMatchWhitespaceOnly: createFault<Statement>(
			420,
			"Patterns must not be able to match an input " +
			"containing only whitespace characters."),
		
		/** */
		PatternAcceptsLeadingWhitespace: createFault<Statement>(
			422,
			"Patterns must not be able to match an input " +
			"containing only whitespace characters."),
		
		/** */
		PatternRequiresLeadingWhitespace: createFault<Statement>(
			424,
			"Patterns must not be able to match an input " +
			"containing only whitespace characters."),
		
		/** */
		PatternAcceptsTrailingWhitespace: createFault<Statement>(
			426,
			"Patterns must not be able to match an input " +
			"containing only whitespace characters."),
		
		/** */
		PatternRequiresTrailingWhitespace: createFault<Statement>(
			428,
			"Patterns must not be able to match an input " +
			"containing only whitespace characters."),
		
		/** */
		PatternNonCovariant: createFault<Statement>(
			440,
			"Pattern does not match it's base types."),
		
		/** */
		PatternPartialWithCombinator: createFault<Statement>(
			442,
			"Partial patterns cannot explicitly match the comma character."),
		
		/** */
		PatternsFormDiscrepantUnion: createFault<Span>(
			499,
			"A union cannot be created between these types because their " + 
			"associated patterns conflict with each other."),
		
		//# Infix related
		
		/** */
		InfixHasQuantifier: createFault<Statement>(
			///0,
			500,
			`Infixes cannot have quantifiers ${quantifiers} applied to them`),
		
		/** */
		InfixHasDuplicateIdentifier: createFault<InfixSpan>(
			///0,
			501,
			"Infixes cannot have duplicate identifiers."),
		
		/** */
		InfixHasSelfReferentialType: createFault<InfixSpan>(
			///410,
			503,
			"Infixes cannot be self-referential."),
		
		/** */
		InfixNonConvariant: createFault<InfixSpan>(
			///412,
			505,
			"Infixes must be compatible with their bases."),
		
		/** */
		InfixCannotDefineNewTypes: createFault<InfixSpan>(
			///422,
			507,
			`A type referenced in an infix must be contained
			by the pattern statement directly, or be contained
			by one of it's matched bases.`),
		
		/** */
		InfixReferencedTypeMustHavePattern: createFault<InfixSpan>(
			///414,
			509,
			"Types applied to an infix must have at least one associated pattern."),
		
		/** */
		InfixReferencedTypeCannotBeRecursive: createFault<InfixSpan>(
			///416,
			511,
			"Types applied to an infix must not create a recursive structure."),
		
		/** */
		InfixContractViolation: createFault<InfixSpan>(
			///424,
			513,
			"Infix type annotations must explicitly expand the type as defined by the base."),
		
		/** */
		InfixPopulationChaining: createFault<InfixSpan>(
			///426,
			515,
			"Population infixes cannot have multiple declarations."),
		
		/** */
		InfixUsingListOperator: createFault<InfixSpan>(
			///0,
			517,
			`Infix identifiers cannot end with the list operator (${Syntax.list}).`),
		
		/** */
		InfixReferencingList: createFault<InfixSpan>(
			///428,
			519,
			"Infixes cannot reference list types."),
		
		/** */
		PortabilityInfixHasMultipleDefinitions: createFault<InfixSpan>(
			///418,
			521,
			`Portability infixes with compatible types cannot
			be specified more than once.`),
		
		/** */
		PortabilityInfixHasUnion: createFault<InfixSpan>(
			///418,
			523,
			"Portability infixes with unioned types are not supported at this time."),
		
		/** */
		PopulationInfixHasMultipleDefinitions: createFault<InfixSpan>(
			///0,
			525,
			`Declarations in a population infix cannot be 
			defined twice in the same pattern`),
		
		/** */
		NominalInfixMustSubtype: createFault<Span>(
			///430,
			527,
			"Patterns with nominal infixes require an input that is " +
			"a subtype of the type specified, not the type itself."),
		
		//# Parse errors
		
		/** */
		StatementBeginsWithComma: createFault<Statement>(
			600,
			"Statements cannot begin with a comma."),
		
		/** */
		StatementBeginsWithEllipsis: createFault<Statement>(
			602,
			"Statements cannot begin with an ellipsis (...)."),
		
		/** */
		StatementBeginsWithEscapedSpace: createFault<Statement>(
			604,
			"Statements cannot begin with an escape character (\\) " + 
			"that is followed by a tab or space."),
		
		/** */
		StatementContainsOnlyEscapeCharacter: createFault<Statement>(
			606,
			"A statement cannot consist of a single escape character (\\)"),
		
		/** */
		StatementBeginsWithInvalidSequence: createFault<Statement>(
			608,
			"A statement cannot begin with the sequences: /*, /+, or /?"),
		
		//# Parsing Faults
		
		/** */
		TabsAndSpaces: createFault<Statement>(
			1000,
			"Statement indent contains a mixture of tabs and spaces.",
			FaultSeverity.warning),
		
		/** */
		DuplicateDeclaration: createFault<Span>(
			1001,
			"Duplicated declaration."),
		
		/** */
		UnterminatedCharacterSet: createFault<Statement>(
			1002,
			`Unterminated character set. Pattern has an opening
			"${RegexSyntaxDelimiter.setStart}" character without a matching
			"${RegexSyntaxDelimiter.setEnd}" character.`),
		
		/** */
		UnterminatedGroup: createFault<Statement>(
			1004,
			`Unterminated group. Pattern has an opening
			"${RegexSyntaxDelimiter.groupStart}" character without a matching
			"${RegexSyntaxDelimiter.groupEnd}" character.`),
		
		/** */
		DuplicateQuantifier: createFault<Statement>(
			1006,
			`Multiple consecutive quantifiers ${quantifiers} are not allowed.`),
		
		/** */
		UnterminatedInfix: createFault<Statement>(
			1008,
			`Unterminated infix. Pattern has an opening ${InfixSyntax.start},
			${InfixSyntax.nominalStart}, ${InfixSyntax.patternStart} delimiter without
			a matching closing delimiter.`),
		
		/** */
		EmptyPattern: createFault<Statement>(
			1010,
			"Pattern has no matchable content.")
	});


	// Additional safety
	Array.from(Faults.each()).every(Object.freeze);
}
