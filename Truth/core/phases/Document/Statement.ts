
namespace Truth
{
	/**
	 * A class that represents a single line within a Truth document.
	 */
	export class Statement extends AbstractClass
	{
		/** @internal */
		readonly class = Class.statement;
		
		/**
		 * @internal
		 * Logical clock value used to make chronological 
		 * creation-time comparisons between Statements.
		 */
		readonly stamp = VersionStamp.next();
		
		/**
		 * @internal
		 * Generator function that yields all statements
		 * (unparsed lines) of the given source text. 
		 */
		static *readFromSource(
			targetDocument: Document,
			sourceText: string)
		{
			const options = createDefaultParseOptions(targetDocument);
			
			if (sourceText.length === 0)
				return;
			
			const end = sourceText.length - 1;
			let statementStart = 0;
			
			for (let cursor = -1;;)
			{
				if (cursor >= end)
				{
					const smtText = sourceText.slice(statementStart);
					yield new Statement(targetDocument, smtText, options);
					return;
				}
				
				cursor++;
				
				if (sourceText[cursor] === Syntax.terminal)
				{
					const smtText = sourceText.slice(statementStart, cursor);
					yield new Statement(targetDocument, smtText, options);
					statementStart = cursor + 1;
				}
			}
		}
		
		/**
		 * @internal
		 */
		static *readFromScript(
			targetDocument: Document,
			sourceObject: SourceObject)
		{
			const options = createDefaultParseOptions(targetDocument);
			
			function *recurse(sourceObject: SourceObject, depth: number):
				IterableIterator<Statement>
			{
				// Methods can only be defined at the second level of depth and
				// higher in the object structure provided.
				const hasMethods = 
					depth > 0 &&
					Object.values(sourceObject).some(v => typeof v === "function");
				
				for (const [declaration, rightSide] of Object.entries(sourceObject))
				{
					const values: any[] = (Array.isArray(rightSide) ? rightSide : [rightSide]);
					const annotations = values
						.filter(v =>
							v !== "" &&
							v !== null &&
							v !== void 0 &&
							v === v &&
							typeof v !== "object")
						.map(v => String(v));
					
					const inners = values.filter(v => !!v && typeof v === "object");
					
					const statementText = 
						Syntax.tab.repeat(depth) + declaration + 
						Syntax.space + Syntax.joint + Syntax.space +
						annotations.join(Syntax.combinator);
					
					yield Statement.new(
						targetDocument,
						statementText,
						options,
						inners);
					
					for (const innerObject of inners)
						yield *recurse(innerObject, depth + 1);
				}
			};
			
			yield *recurse(sourceObject, 0);
		}
		
		/**
		 * @internal
		 * Creates a temporary statement that will not be attached to any document,
		 * and will not report any faults.
		 */
		static newTemporary(statementText: string, options: IParserOptions)
		{
			return new Statement(null, statementText, options);
		}
		
		/**
		 * @internal
		 * Creates a new statement object, using the private constructor.
		 */
		static new(
			document: Document,
			statementText: string,
			options: IParserOptions = createDefaultParseOptions(document),
			methods: SourceObjectMethods[] = [])
		{
			return new Statement(document, statementText, options, methods);
		}
		
		/** */
		private constructor(
			document: Document | null,
			statementText: string,
			options: IParserOptions,
			methods: SourceObjectMethods[] = [])
		{
			super();
			this.methods = methods;
			
			// This is where the parsing of a statement begins.
			// The algorithm used is some kind of quasi-recusive descent with
			// lookheads and backtracking in some places to make the logic easier
			// to follow. Technically, it's probably some mash-up of LL(k) & LALR.
			// Maybe if I blew 4 years of my life in some silly Comp Sci program
			// instead of dropping out of high school I could say for sure.
			
			const scanner = new Scanner(statementText);
			const indent = scanner.readWhitespace();
			const declarationEntries: Boundary<Subject>[] = [];
			const annotationEntries: Boundary<Term>[] = [];
			let flags = StatementFlags.none;
			let jointPosition = -1;
			let sum = "";
			let faultType: StatementFaultType | null = null;
			
			const shouldFinalize = (() =>
			{
				if (!scanner.more())
				{
					flags |= StatementFlags.isWhitespace;
					return false;
				}
				
				const markBegin = scanner.position;
				if (scanner.read(Syntax.comment))
				{
					if (!scanner.more() || scanner.read(Syntax.space) || scanner.read(Syntax.tab))
					{
						flags |= StatementFlags.isComment;
						return false;
					}
					
					scanner.position = markBegin;
				}
				
				const unparsableFaultType = (() =>
				{
					if (scanner.read(Syntax.combinator))
						return Faults.StatementBeginsWithComma;
					
					if (scanner.read(Syntax.list))
						return Faults.StatementBeginsWithEllipsis;
					
					const esc = Syntax.escapeChar;
					
					if (scanner.read(esc + Syntax.space) || scanner.read(esc + Syntax.tab))
						return Faults.StatementBeginsWithEscapedSpace;
					
					if (scanner.readThenTerminal(esc))
						return Faults.StatementContainsOnlyEscapeCharacter;
					
					return null;
				})();
				
				if (unparsableFaultType)
				{
					flags |= StatementFlags.isCruft;
					faultType = unparsableFaultType;
					return false;
				}
				
				const markBeforeUri = scanner.position;
				const uri = Parser.maybeParseUri(scanner, options);
				if (uri)
				{
					flags |= StatementFlags.hasUri;
					declarationEntries.push(new Boundary(
						markBeforeUri,
						scanner.position,
						uri));
					
					return true;
				}
				
				const markBeforePattern = scanner.position;
				const pattern = Parser.maybeParsePattern(scanner, options);
				
				if (Parser.isFault(pattern))
				{
					flags |= StatementFlags.isCruft;
					faultType = pattern;
					return false;
				}
				
				if (pattern)
				{
					flags |= StatementFlags.hasPattern;
					flags |= pattern.isTotal ?
						StatementFlags.hasTotalPattern :
						StatementFlags.hasPartialPattern;
					
					declarationEntries.push(new Boundary(
						markBeforePattern,
						scanner.position,
						pattern));
					
					return true;
				}
				
				for (const boundsEntry of Parser.parseDeclarations(scanner, []))
					declarationEntries.push(boundsEntry);
				
				return true;
			})();
			
			if (shouldFinalize)
			{
				jointPosition = Parser.maybeParseJoint(scanner);
				
				const readResult = Parser.readAnnotations(scanner, []);
				sum = readResult.raw.trim();
				
				for (const boundsEntry of readResult.annotations)
					annotationEntries.push(boundsEntry);
				
				if (jointPosition > -1)
				{
					const dLen = declarationEntries.length;
					const aLen = readResult.annotations.length;
					
					if (dLen === 0)
					{
						declarationEntries.unshift(new Boundary(
							jointPosition,
							jointPosition,
							Term.void));
						
						if (aLen === 0)
							flags |= StatementFlags.isVacuous;
					}
					else if (aLen === 0)
					{
						flags |= StatementFlags.isRefresh;
					}
				}
			}
			
			// It must be possible to create a statement without a document
			// in order to support tests. This should not occur in the non-test
			// flow of the system.
			this.document = document || (null as any);
			this.sourceText = statementText;
			this.sum = sum;
			this.indent = indent;
			this.flags = flags;
			this.jointPosition = jointPosition;
			
			const allDeclarations: Span[] = this.allDeclarations = [];
			for (const boundary of declarationEntries)
				allDeclarations.push(new Span(this, boundary));
			
			const allAnnotations: Span[] = this.allAnnotations = [];
			for (const boundary of annotationEntries)
				allAnnotations.push(new Span(this, boundary));
			
			const faults: Fault[] = [];
			const cruftObjects = new Set<Statement | Span | InfixSpan>();
			
			if (document)
			{
				if (faultType !== null)
					faults.push(new Fault(faultType, this));
				
				for (const fault of this.eachParseFault())
				{
					if (fault.type.severity === FaultSeverity.error)
						cruftObjects.add(fault.source);
					
					faults.push(fault);
				}
			
				for (const fault of faults)
					// Check needed to support the unit tests, the feed
					// fake document objects into the statement constructor.
					if (document.program && document.program.faults)
						document.program.faults.report(fault);
			}
			
			this.cruftObjects = cruftObjects;
			this.faults = Object.freeze(faults);
		}
		
		/**
		 * 
		 */
		private *eachParseFault(): IterableIterator<Readonly<Fault<TFaultSource>>>
		{
			// Check for tabs and spaces mixture
			if (this.indent > 0)
			{
				let hasTabs = false;
				let hasSpaces = false;
				
				for (let i = -1; ++i < this.indent;)
				{
					const chr = this.sourceText[i];
					
					if (chr === Syntax.tab)
						hasTabs = true;
					
					if (chr === Syntax.space)
						hasSpaces = true;
				}
				
				if (hasTabs && hasSpaces)
					yield new Fault(Faults.TabsAndSpaces, this);
			}
			
			if (this.allDeclarations.length > 1)
			{
				const subjects: string[] = [];
				
				for (const span of this.allDeclarations)
				{
					const subText = span.toString();
					if (subjects.includes(subText))
						yield new Fault(Faults.DuplicateDeclaration, span);
					else
						subjects.push(subText);
				}
			}
			
			if (this.allAnnotations.length > 0)
			{
				// This performs an expedient check for "ListIntrinsicExtendingList",
				// however, full type analysis is required to cover all cases where
				// this fault may be reported.
				const getListSpans = (spans: readonly Span[]) => spans.filter(span =>
				{
					const sub = span.boundary.subject;
					return sub instanceof Term && sub.isList;
				});
				
				const lhsListSpans = getListSpans(this.allDeclarations);
				const rhsListSpans = getListSpans(this.allAnnotations);
				
				if (lhsListSpans.length > 0 && rhsListSpans.length > 0)
					for (const span of rhsListSpans)
						yield new Fault(Faults.ListIntrinsicExtendingList, span);
			}
			
			const pattern = (() =>
			{
				if (this.allDeclarations.length === 0)
					return null;
				
				const hp = StatementFlags.hasPattern;
				if ((this.flags & hp) !== hp)
					return null;
				
				const subject = this.allDeclarations[0].boundary.subject;
				return subject instanceof Pattern ?
					subject :
					null;
			})();
			
			if (pattern === null)
				return;
			
			if (!pattern.isValid)
			{
				yield new Fault(Faults.PatternInvalid, this);
				return;
			}
			
			if (this.allAnnotations.length === 0)
				yield new Fault(Faults.PatternWithoutAnnotation, this);
			
			if (pattern.test(""))
				yield new Fault(Faults.PatternCanMatchEmpty, this);
			
			if (!pattern.isTotal)
				for (const unit of pattern.eachUnit())
					if (unit instanceof RegexGrapheme)
						if (unit.grapheme === Syntax.combinator)
						{
							yield new Fault(Faults.PatternPartialWithCombinator, this);
							break;
						}
			
			const patternSpan = this.allDeclarations[0];
			if (patternSpan.infixes.length === 0)
				return;
			
			const infixSpans: InfixSpan[] = [];
			
			for (const infix of patternSpan.infixes)
			{
				const lhs = Array.from(patternSpan.eachDeclarationForInfix(infix));
				const rhs = Array.from(patternSpan.eachAnnotationForInfix(infix));
				const all = lhs.concat(rhs);
				
				// This is a bit out of place ... but we need to populate the
				// infixSpans array and this is probably the most efficient
				// place to do that.
				infixSpans.push(...all);
				
				for (const infixSpan of all)
					if (infixSpan.boundary.subject.isList)
						yield new Fault(Faults.InfixUsingListOperator, infixSpan);
				
				yield *normalizeInfixSpans(lhs);
				yield *normalizeInfixSpans(rhs);
				
				const lhsSubjects = lhs.map(nfxSpan => 
					nfxSpan.boundary.subject.toString());
				
				for (const infixSpan of rhs)
					if (lhsSubjects.includes(infixSpan.boundary.subject.toString()))
						yield new Fault(Faults.InfixHasSelfReferentialType, infixSpan);
				
				if (infix.isPopulation)
					for (let idx = 1; idx < lhs.length; idx++)
						yield new Fault(Faults.InfixPopulationChaining, lhs[idx]);
				
				yield *expedientListCheck(lhs);
				yield *expedientListCheck(rhs);
			}
			
			for (const infixSpan of eachRepeatedInfix(
				patternSpan,
				infix => patternSpan.eachDeclarationForInfix(infix)))
			{
				if (infixSpan.containingInfix.isPopulation)
					yield new Fault(
						Faults.PopulationInfixHasMultipleDefinitions,
						infixSpan);
			}
			
			for (const infixSpan of eachRepeatedInfix(
				patternSpan,
				infix => patternSpan.eachAnnotationForInfix(infix)))
			{
				if (infixSpan.containingInfix.isPortability)
					yield new Fault(
						Faults.PortabilityInfixHasMultipleDefinitions, 
						infixSpan);
			}
			
			this._infixSpans = Object.freeze(infixSpans);
		}
		
		/**
		 * Gets whether the joint operator exists at the
		 * end of the statement, forcing the statement's
		 * declarations to be "refresh types".
		 */
		get isRefresh()
		{
			const f = StatementFlags.isRefresh;
			return (this.flags & f) === f;
		}
		
		/**
		 * Gets whether the statement contains nothing
		 * other than a single joint operator.
		 */
		get isVacuous()
		{
			const f = StatementFlags.isVacuous;
			return (this.flags & f) === f;
		}
		
		/**
		 * Gets whether the statement is a comment.
		 */
		get isComment()
		{
			const f = StatementFlags.isComment;
			return (this.flags & f) === f;
		}
		
		/**
		 * Gets whether the statement contains
		 * no non-whitespace characters.
		 */
		get isWhitespace()
		{
			const f = StatementFlags.isWhitespace;
			return (this.flags & f) === f;
		}
		
		/**
		 * Gets whether the statement is a comment or whitespace.
		 */
		get isNoop()
		{
			return this.isComment || this.isWhitespace;
		}
		
		/**
		 * Gets whether this Statement has been removed from it's
		 * containing document. Removal occurs after the statement
		 * has been invalidated. Therefore, this property will be false
		 * before the invalidation phase has occured, even if it will be
		 * disposed in the current edit transaction.
		 */
		get isDisposed()
		{
			const f = StatementFlags.isDisposed;
			return (this.flags & f) === f;
		}
		
		/**
		 * Gets whether the Statement has been marked as cruft,
		 * due to a parsing error (and specifically not a type error).
		 */
		get isCruft()
		{
			const f = StatementFlags.isCruft;
			return (this.flags & f) === f;
		}
		
		/**
		 * Gets the URI embedded within the Statement, in the case
		 * when the statement is a URI statement.
		 * 
		 * Gets null in the case when the Statement is not a URI
		 * statement.
		 */
		get uri()
		{
			const f = StatementFlags.hasUri;
			return (this.flags & f) === f ?
				this.declarations[0].boundary.subject as KnownUri :
				null;
		}
		
		/** @internal */
		private flags = StatementFlags.none;
		
		/** Stores a list of the parse-related faults that were detected on this Statement. */
		readonly faults: readonly Fault[];
		
		/** Stores a reference to the document that contains this Statement. */
		readonly document: Document;
		
		/** Stores the indent level of the Statement. */
		readonly indent: number;
		
		/**
		 * Stores the set of objects that are contained by this Statement, 
		 * and are marked as cruft. Note that the only Statement object
		 * that may be located in this set is this Statement object itself.
		 */
		readonly cruftObjects: ReadonlySet<Statement | Span | InfixSpan>;
		
		/**
		 * Gets the line number of this statement in it's containing
		 * document, or -1 if the statement is disposed and/or is not
		 * in the document.
		 */
		get line()
		{
			if (this.isDisposed)
				return -1;
			
			return this.document instanceof Document ?
				this.document.lineNumberOf(this) :
				-1;
		}
		
		/**
		 * Gets an array of spans in that represent the declarations
		 * of this statement, excluding those that have been marked
		 * as object-level cruft.
		 */
		get declarations()
		{
			if (this.cruftObjects.size === 0)
				return this.allDeclarations;
			
			const out: Span[] = [];
			
			for (const span of this.allDeclarations)
				if (!this.cruftObjects.has(span))
					out.push(span);
			
			return Object.freeze(out);
		}
		
		/**
		 * Stores the array of spans that represent the declarations
		 * of this statement, including those that have been marked
		 * as object-level cruft.
		 */
		readonly allDeclarations: readonly Span[];
		
		/**
		 * Gets a list of all infixes defined in the pattern of this statement.
		 */
		get infixSpans()
		{
			return this._infixSpans;
		}
		private _infixSpans: readonly InfixSpan[] = Object.freeze([]);
		
		/**
		 * Gets an array of spans in that represent the annotations
		 * of this statement, from left to right, excluding those that
		 * have been marked as object-level cruft.
		 */
		get annotations()
		{
			if (this.cruftObjects.size === 0)
				return this.allAnnotations;
			
			const out: Span[] = [];
			
			for (const span of this.allAnnotations)
				if (!this.cruftObjects.has(span))
					out.push(span);
			
			return Object.freeze(out);
		}
		
		/**
		 * Stores the array of spans that represent the annotations
		 * of this statement, including those that have been marked
		 * as object-level cruft.
		 */
		readonly allAnnotations: readonly Span[];
		
		/**
		 * Gets an array of spans in that represent both the declarations
		 * and the annotations of this statement, excluding those that have
		 * been marked as object-level cruft.
		 */
		get spans()
		{
			return this.isCruft ?
				[] :
				this.declarations.concat(this.annotations);
		}
		
		/**
		 * 
		 */
		get allSpans()
		{
			return this.declarations.concat(this.annotations);
		}
		
		/**
		 * Stores the position at which the joint operator exists
		 * in the statement. A negative number indicates that
		 * the joint operator does not exist in the statement.
		 */
		readonly jointPosition: number;
		
		/**
		 * Stores the unprocessed text content of the statement, 
		 * as it appears in the document.
		 */
		readonly sourceText: string;
		
		/**
		 * Stores the statement's textual *sum*, which is the
		 * raw text of the statement's annotations, with whitespace
		 * trimmed. The sum is suitable as an input to a total
		 * pattern.
		 */
		readonly sum: string;
		
		/**
		 * Gets a boolean value indicating whether or not the
		 * statement contains a declaration of a pattern.
		 */
		get hasPattern()
		{
			const d = this.allDeclarations;
			return d.length === 1 && d[0].boundary.subject instanceof Pattern;
		}
		
		/**
		 * @internal
		 * Stores an array of SourceObjectMethods objects that were defined
		 * as being in correspondence with this statement.  In the case when
		 * this Statement was not generated from a scripted document, the
		 * stored value is an empty aray.
		 */
		readonly methods: readonly SourceObjectMethods[];
		
		/**
		 * @internal
		 * Marks the statement as being removed from it's containing document.
		 */
		dispose()
		{
			this.flags = this.flags | StatementFlags.isDisposed;
		}
		
		/**
		 * @returns The kind of StatementZone that exists
		 * at the given character offset within the Statement.
		 */
		getZone(offset: number)
		{
			if (this.isComment || offset < this.indent || this.isCruft)
				return StatementZone.void;
			
			if (this.isWhitespace)
				return StatementZone.whitespace;
			
			if (this.hasPattern)
			{
				const bnd = this.allDeclarations[0].boundary;
				if (offset >= bnd.offsetStart && offset <= bnd.offsetEnd)
					return StatementZone.pattern;
			}
			
			if (offset <= this.jointPosition || this.jointPosition < 0)
			{
				for (const span of this.allDeclarations)
				{
					const bnd = span.boundary;
					if (offset >= bnd.offsetStart && offset <= bnd.offsetEnd)
						return StatementZone.declaration;
				}
				
				return StatementZone.declarationVoid;
			}
			
			for (const span of this.allAnnotations)
			{
				const bnd = span.boundary;
				if (offset >= bnd.offsetStart && offset <= bnd.offsetEnd)
					return StatementZone.annotation;
			}
			
			return StatementZone.annotationVoid;
		}
		
		/**
		 * 
		 */
		getSubject(offset: number)
		{
			return this.getDeclaration(offset) || this.getAnnotation(offset);
		}
		
		/**
		 * @returns A span to the declaration subject at the 
		 * specified offset, or null if there is none was found.
		 */
		getDeclaration(offset: number)
		{
			for (const span of this.declarations)
			{
				const bnd = span.boundary;
				if (offset >= bnd.offsetStart && offset <= bnd.offsetEnd)
					return span;
			}
			
			return null;
		}
		
		/**
		 * @returns A span to the annotation subject at the 
		 * specified offset, or null if there is none was found.
		 */
		getAnnotation(offset: number)
		{
			for (const span of this.annotations)
			{
				const bnd = span.boundary;
				if (offset >= bnd.offsetStart && offset <= bnd.offsetEnd)
					return span;
			}
			
			return null;
		}
		
		/**
		 * @returns A string containing the inner comment text of
		 * this statement, excluding the comment syntax token.
		 * If the statement isn't a comment, an empty string is returned.
		 */
		getCommentText()
		{
			return this.isComment ?
				this.sourceText.slice(this.indent + Syntax.comment.length).trim() :
				"";
		}
		
		/**
		 * Converts the statement to a formatted string representation.
		 */
		toString(includeIndent = false)
		{
			const serializeSpans = (
				spans: readonly Span[],
				escStyle: TermEscapeKind) =>
			{
				return spans
					.filter(sp => !(sp.boundary.subject instanceof Anon))
					.map(sp => Subject.serializeExternal(sp, escStyle))
					.join(Syntax.combinator + Syntax.space);
			};
			
			const indent = includeIndent ? Syntax.tab.repeat(this.indent) : "";
			
			if (this.isCruft)
				return indent + "(cruft)";
			
			if (this.isWhitespace)
				return indent;
			
			if (this.isVacuous)
				return indent + Syntax.joint;
			
			const decls = serializeSpans(this.allDeclarations, TermEscapeKind.declaration);
			const annos = serializeSpans(this.allAnnotations, TermEscapeKind.annotation);
			
			const joint = annos.length > 0 || this.isRefresh ? Syntax.joint : "";
			const jointL = decls.length > 0 && joint !== "" ? Syntax.space : "";
			const jointR = annos.length > 0 ? Syntax.space : "";
			
			return indent + decls + jointL + joint + jointR + annos;
		}
	}
	
	/**
	 * Defines the areas of a statement that are significantly
	 * different when performing inspection.
	 */
	export enum StatementZone
	{
		/**
		 * Refers to the area within a comment statement,
		 * or the whitespace preceeding a non-no-op.
		 */
		void,
		
		/**
		 * Refers to the area in the indentation area.
		 */
		whitespace,
		
		/**
		 * Refers to the 
		 */
		pattern,
		
		/** */
		declaration,
		
		/** */
		annotation,
		
		/** */
		declarationVoid,
		
		/** */
		annotationVoid
	}
	
	/**
	 * A bit field enumeration used to efficiently store
	 * meta data about a Line (or a Statement) object.
	 */
	export enum StatementFlags
	{
		none = 0,
		isRefresh = 1,
		isVacuous = 2,
		isComment = 4,
		isWhitespace = 8,
		isDisposed = 16,
		isCruft = 32,
		hasUri = 64,
		hasTotalPattern = 128,
		hasPartialPattern = 256,
		hasPattern = 512
	}
	
	/**
	 * Yields faults on infix spans in the case when a term
	 * exists multiple times within the same infix.
	 */
	function *normalizeInfixSpans(side: InfixSpan[])
	{
		if (side.length === 0)
			return;
		
		const subjects = new Set<Subject>();
		
		for (const nfxSpan of side)
		{
			const sub = nfxSpan.boundary.subject;
			if (subjects.has(sub))
				yield new Fault(Faults.InfixHasDuplicateTerm, nfxSpan);
			
			else
				subjects.add(sub);
		}
	}
	
	/**
	 * Yields faults on infix spans in the case when a term
	 * has been re-declared multiple times across the infixes.
	 * 
	 * Yields infixes that have terms that exist multiple times
	 * within the same statement.
	 */
	function *eachRepeatedInfix(
		span: Span,
		infixFn: (nfx: Infix) => IterableIterator<InfixSpan>)
	{
		const subjects = new Set<Subject>();
		
		for (const infix of span.infixes)
		{
			const infixSpans = Array.from(infixFn(infix));
			
			for (const infixSpan of infixSpans)
			{
				const sub = infixSpan.boundary.subject;
				
				if (subjects.has(sub))
					yield infixSpan;
				
				else
					subjects.add(sub);
			}
		}
	}
	
	/**
	 * Performs a quick and dirty check to see if the infix is referencing
	 * a list, by looking to see if it has the list operator. A full check needs
	 * to perform type inspection to see if any of the types that correspond
	 * to the terms specified are actually lists.
	 */
	function *expedientListCheck(side: InfixSpan[])
	{
		if (side.length === 0)
			return;
		
		for (const nfxSpan of side)
			if (nfxSpan.boundary.subject.isList)
				yield new Fault(Faults.InfixUsingListOperator, nfxSpan);
	}
	
	/**
	 * 
	 */
	function createDefaultParseOptions(doc: Document): IParserOptions
	{
		return {
			assumedUri: doc.uri,
			readPatterns: true,
			readUris: true
		};
	}
}
