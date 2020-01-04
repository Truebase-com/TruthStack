
namespace Truth
{
	/**
	 * A class that manages a single Truth document loaded as part of
	 * a Program.
	 * 
	 * Truth documents may be loaded from files, or they may be loaded
	 * from a string of Truth content directly (see the associated methods
	 * in Truth.Program).
	 */
	export class Document
	{
		/**
		 * @internal
		 * Internal constructor for Document objects.
		 * Document objects are created via a Program object.
		 * 
		 * @param source 
		 */
		static async new(
			program: Program,
			source: Uri | string,
			saveFn: (doc: Document) => void): Promise<Document | Error>
		{
			const sourceUri = source instanceof Uri ?
				source :
				Uri.createInternal();
			
			let sourceText = await (async () =>
			{
				if (typeof source === "string")
					return source;
				
				const uriAbsolute = source.toAbsolute();
				if (!uriAbsolute)
					throw Exception.unknownState();
				
				const readResult = await UriReader.tryRead(uriAbsolute);
				if (readResult instanceof Error)
					return readResult;
				
				return readResult;
			})();
			
			if (sourceText instanceof Error)
				return sourceText;
			
			const doc = new Document(program, sourceUri);
			const uriStatements: UriStatement[] = [];
			
			for (const statementText of DocumentUtil.readLines(sourceText))
			{
				const smt = new Statement(doc, statementText)
				doc.statements.push(smt);
				
				if (smt.uri)
					uriStatements.push(smt as UriStatement);
			}
			
			// Calling this function saves the document in the Program instance
			// that invoked this new Document. This is a bit spagetti-ish, but the
			// newly created document has to be in the Program's .documents
			// array, or the updating of references won't work.
			saveFn(doc);
			
			if (uriStatements.length > 0)
				await doc.updateReferences([], uriStatements);
			
			return doc;
		}
		
		/** */
		private constructor(program: Program, sourceUri: Uri)
		{
			if (sourceUri.types.length)
				throw Exception.invalidArgument();
			
			this.program = program;
			this._sourceUri = sourceUri;
		}
		
		/** Stores the URI from where this document was loaded. */
		get sourceUri()
		{
			return this._sourceUri;
		}
		private _sourceUri: Uri;
		
		/**
		 * Updates this Document's sourceUri with the new URI specified.
		 * 
		 * Note: Setting this method can break other documents that are 
		 * referring to this document via a URI. Use with caution.
		 * 
		 * @throws An error in the case when a document has been loaded
		 * into the Program that is already associated with the URI specified.
		 */
		updateUri(newUri: Uri)
		{
			const existing = this.program.getDocumentByUri(newUri);
			if (existing)
				throw Exception.cannotAssignUri();
			
			this._sourceUri = newUri;
		}
		
		/**
		 * @internal
		 * A rolling version stamp that increments after each edit transaction.
		 */
		get version()
		{
			return this._version;
		}
		private _version = VersionStamp.next();
		
		/**
		 * Stores the complete list of the Document's statements,
		 * sorted in the order that they appear in the file.
		 */
		private readonly statements: Statement[] = [];
		
		/**
		 * Stores references to the Statement objects within the
		 * .statements field that contain Uri instances.
		 */
		private readonly uriStatements: UriStatement[] = [];
		
		/**
		 * 
		 */
		private async updateReferences(
			deleted: UriStatement[],
			added: UriStatement[])
		{
			// This algorithm always performs all deletes before adds.
			// For this reason, if a URI is both in the list of deleted URIs
			// as well as the list of added URIs, it means that the URI
			// started in the document, and is currently still there.
			
			const existing = this.uriStatements.slice();
			
			// Delete old URI statements from the array.
			for (const del of deleted)
			{
				const idxDel = existing.indexOf(del);
				if (idxDel > -1)
					existing.splice(idxDel, 1);
			}
			
			const toTuples = (smts: UriStatement[]) =>
				smts.map(smt => [this.getLineNumber(smt), smt] as [number, UriStatement]);
			
			const concatenated = [
				...toTuples(existing),
				...toTuples(added)
			];
			
			// If you specify the same URI more than once, it has to generate a fault.
			// If it's faulty ... you still need to store it.
			// For this reason, the UriStatements array is not necessarily equivalent
			// to the dependencies array.
			
			const proposedUriSmts = concatenated
				.sort(([numA], [numB]) => numB - numA)
				.map(([num, uriSmt]) => uriSmt);
			
			const uriTexts = proposedUriSmts.map(smt => smt.uri.toStoreString());
			const faultyStatements: UriStatement[] = [];
			
			const report = (type: Readonly<FaultType<Statement>>, smt: UriStatement) =>
			{
				const fault = type.create(smt);
				this.program.faults.reportAsync(fault);
				faultyStatements.push(smt);
			};
			
			// Searches through the proposed final list of URIs, and reports 
			// faults on the statements that contain URIs, where those URIs
			// are referenced in a preceeding statement .
			for (const [i, uriText] of uriTexts.entries())
				if (uriTexts.indexOf(uriText) < i)
					report(Faults.DuplicateReference, proposedUriSmts[i]);
			
			const dependencies = ([] as (Document | null)[]).fill(null, 0, proposedUriSmts.length);
			
			// Attempt to load the documents referenced in each new UriStatement.
			for await (const [i, smt] of proposedUriSmts.entries())
			{
				if (faultyStatements.includes(smt))
					continue;
				
				if (existing.includes(smt))
				{
					dependencies[i] = this.dependencies.find(v => v.sourceUri.equals(smt.uri)) || null;
					continue;
				}
				
				if (!added.includes(smt))
					continue;
				
				// Bail if a document loaded from HTTP is trying to reference
				// a document located on the file system.
				const isToFile = smt.uri.protocol === UriProtocol.file;
				const thisProto = this.sourceUri.protocol;
				
				if (isToFile && (thisProto === UriProtocol.http || thisProto === UriProtocol.https))
				{
					report(Faults.InsecureResourceReference, smt);
					continue;
				}
				
				let refDoc: Document | Error | null = this.program.getDocumentByUri(smt.uri);
				if (!refDoc)
					refDoc = await this.program.addDocumentFromUri(smt.uri);
				
				if (!(refDoc instanceof Document))
				{
					report(Faults.UnresolvedResource, smt);
					continue;
				}
				
				if (this.isUnlinkable(refDoc))
				{
					report(Faults.CircularResourceReference, smt);
					continue;
				}
				
				dependencies[i] = refDoc;
			}
			
			const newDeps = dependencies.filter((v): v is Document => !!v);
			const addedDeps = newDeps.filter(v => !this._dependencies.includes(v));
			const removedDeps = this._dependencies.filter(v => !newDeps.includes(v));
			
			for (const addedDep of addedDeps)
				addedDep._dependents.push(this);
			
			for (const removedDep of removedDeps)
				removedDep._dependents.splice(removedDep._dependents.indexOf(this), 1);
			
			// TODO: Broadcast the added and removed dependencies to external
			// observers (outside the compiler). Implementing this will require a
			// re-working of the cause system.
			
			this._dependencies.length = 0;
			this._dependencies.push(...newDeps);
			
			this.uriStatements.length = 0;
			this.uriStatements.push(...proposedUriSmts);
		}
		
		/**
		 * Checks to see if the addition of a reference between this
		 * document and the specified proposed document would result
		 * in a document graph with circular relationships.
		 * 
		 * The algorithm used performs a depth-first dependency search,
		 * starting at the desiredReference. If the traversal pattern is able
		 * to make its way back to this document, it can be concluded that
		 * the addition of the proposed reference would result in a cyclical
		 * relationship.
		 */
		private isUnlinkable(proposedReference: Document)
		{
			const hasCyclesRecursive = (current: Document) =>
			{
				// Found a path to the .this document
				if (current === this)
					return true;
				
				for (const dependency of current._dependencies)
					if (hasCyclesRecursive(dependency))
						return true;
				
				return false;
			};
			
			return hasCyclesRecursive(proposedReference);
		}
		
		/** */
		get dependencies(): readonly Document[]
		{
			return this._dependencies;
		}
		private readonly _dependencies: Document[] = [];
		
		/** */
		get dependents(): readonly Document[]
		{
			return this._dependents;
		}
		private readonly _dependents: Document[] = [];
		
		/** A reference to the instance of the Compiler that owns this Document. */
		readonly program: Program;
		
		/**
		 * Queries this document for the root-level types.
		 * 
		 * @param uri The URI of the document to query. If the URI contains
		 * a type path, it is factored into the search.
		 * 
		 * @param typePath The type path within the document to search.
		 * 
		 * @returns A fully constructed Type instance that corresponds to
		 * the type at the URI specified, or null in the case when no type
		 * could be found.
		 */
		query(...typePath: string[]): Type | null
		{
			return this.program.query(this, ...typePath);
		}
		
		/**
		 * Gets the root-level types that are defined within this document.
		 */
		get types()
		{
			if (this._types)
				return this._types;
			
			return this._types = Object.freeze(this.program.query(this));
		}
		private _types: readonly Type[] | null = null;
		
		/**
		 * @returns An array of Statement objects that represent
		 * ancestry of the specified statement. If the specified
		 * statement is not in this document, the returned value
		 * is null.
		 */
		getAncestry(statement: Statement | number)
		{
			const smt = this.toStatement(statement);
			
			// If the statement is root-level, it can't have an ancestry.
			if (smt.indent === 0)
				return [];
			
			const startingIndex = this.toLineNumber(statement);
			
			if (startingIndex < 0)
				return null;
			
			if (startingIndex === 0)
				return [];
			
			const ancestry = [smt];
			let indentToBeat = smt.indent;
			
			for (let idx = startingIndex; --idx > -1;)
			{
				const currentStatement = this.statements[idx];
				if (currentStatement.isNoop)
					continue;
				
				if (currentStatement.indent < indentToBeat)
				{
					ancestry.unshift(currentStatement);
					indentToBeat = currentStatement.indent;
				}
				
				if (currentStatement.indent === 0)
					break;
			}
			
			return ancestry.slice(0, -1);
		}
		
		/**
		 * @returns The parent Statement object of the specified
		 * Statement. If the statement is top level, a reference to
		 * this document object is returned. If the statement is
		 * not found in the document, or the specified statement
		 * is a no-op, the returned value is null.
		 */
		getParent(statement: Statement | number)
		{
			const smt = this.toStatement(statement);
			
			if (smt.isNoop)
				return null;
			
			// If the statement is root-level, it can't have a parent.
			if (smt.indent === 0)
				return this;
			
			const startingIndex = this.toLineNumber(statement);
			
			if (startingIndex < 0)
				return null;
			
			if (startingIndex === 0)
				return this;
			
			const currentIndent = smt.indent;
			
			for (let idx = startingIndex; --idx > -1;)
			{
				const currentStatement = this.statements[idx];
				if (currentStatement.isNoop)
					continue;
				
				if (currentStatement.indent < currentIndent)
					return currentStatement;
			}
			
			// If a parent statement wasn't found, then the
			// input statement is top-level, and a reference
			// to this Document object is returned.
			return this;
		}
		
		/**
		 * @returns The Statement that would act as the parent 
		 * if a statement where to be inserted at the specified
		 * virtual position in the document. If an inserted
		 * statement would be top-level, a reference to this 
		 * document object is returned.
		 */
		getParentFromPosition(virtualLine: number, virtualOffset: number): Statement | this
		{
			if (virtualLine === 0 || virtualOffset < 1 || this.statements.length === 0)
				return this;
			
			const line = DocumentUtil.applyBounds(virtualLine, this.statements.length);
			
			for (let idx = line; idx--;)
			{
				const currentStatement = this.statements[idx];
				if (!currentStatement.isNoop && currentStatement.indent < virtualOffset)
					return currentStatement;
			}
			
			return this;
		}
		
		/**
		 * @returns The sibling Statement objects of the 
		 * specified Statement. If the specified statement
		 * is not found in the document, or is a no-op, the
		 * returned value is null.
		 */
		getSiblings(statement: Statement | number)
		{
			const smt = this.toStatement(statement);
			
			if (smt.isNoop)
				return null;
			
			if (smt.indent === 0)
				return this.getChildren(null);
			
			const parent = this.getParent(smt);
			
			if (parent === null)
				return null;
			
			if (parent === this)
				return parent.getChildren(null);
			
			return this.getChildren(<Statement>parent);
		}
		
		/**
		 * @returns The child Statement objects of the specified
		 * Statement. If the argument is null or omitted, the document's
		 * top-level statements are returned. If the specified statement 
		 * is not found in the document, the returned value is null.
		 */
		getChildren(statement: Statement | null = null)
		{
			const children: Statement[] = [];
			
			// Stores the indent value that causes the loop
			// to terminate when reached.
			const breakIndent = statement ? statement.indent : -1;
			let childIndent = Number.MAX_SAFE_INTEGER;
			
			const startIdx = statement ? 
				this.getLineNumber(statement) :
				-1;
				
			if (startIdx >= this.statements.length)
				return [];
			
			for (let idx = startIdx; ++idx < this.statements.length;)
			{
				const currentStatement = this.statements[idx];
				
				if (currentStatement.isNoop)
					continue;
				
				// Check if we need to back up the indentation
				// of child statements, in order to deal with bizarre
				// (but unfortunately, valid) indentation.
				if (currentStatement.indent < childIndent)
					childIndent = currentStatement.indent;
				
				// If we've reached the end of a series of a
				// statement locality.
				if (currentStatement.indent <= breakIndent)
					break;
				
				if (currentStatement.indent <= childIndent)
					children.push(currentStatement);
			}
			
			return children;
		}
		
		/**
		 * @returns A boolean value that indicates whether the specified
		 * statement, or the statement at the specified index has any
		 * descendants. If the argument is null, the returned value is a
		 * boolean indicating whether this document has any non-noop
		 * statements.
		 */
		hasDescendants(statement: Statement | number | null)
		{
			if (statement === null)
			{
				for (let idx = -1; ++idx < this.statements.length;)
					if (!this.statements[idx].isNoop)
						return true;
			}
			else
			{
				const smt = statement instanceof Statement ?
					statement : 
					this.statements[statement];
				
				if (smt.isNoop)
					return false;
				
				let idx = statement instanceof Statement ?
					this.getLineNumber(statement) :
					statement;
				
				while (++idx < this.statements.length)
				{
					const currentStatement = this.statements[idx];
					if (currentStatement.isNoop)
						continue;
					
					return currentStatement.indent > smt.indent;
				}
			}
			
			return false;
		}
		
		/**
		 * @returns The index of the specified statement in
		 * the document, relying on caching when available.
		 * If the statement does not exist in the document,
		 * the returned value is -1.
		 */
		getLineNumber(statement: Statement)
		{
			return this.statements.indexOf(statement);
		}
		
		/** 
		 * @returns An array of strings containing the content
		 * written in the comments directly above the specified
		 * statement. Whitespace lines are ignored. If the specified
		 * statement is a no-op, an empty array is returned.
		 */
		getNotes(statement: Statement | number)
		{
			const smt = this.toStatement(statement);
			if (smt.isNoop)
				return [];
			
			const lineNum = this.getLineNumber(smt);
			if (lineNum < 1)
				return [];
			
			const commentLines: string[] = [];
			const requiredIndent = smt.indent;
			
			for (let num = lineNum; num--;)
			{
				const currentStatement = this.statements[num];
				
				if (currentStatement.isWhitespace)
					continue;
				
				const commentText = currentStatement.getCommentText();
				if (commentText === null)
					break;
				
				if (currentStatement.indent !== requiredIndent)
					break;
				
				commentLines.push(commentText);
			}
				
			return commentLines;
		}
		
		/**
		 * Enumerates through each statement that is a descendant of the 
		 * specified statement. If the parameters are null or omitted, all 
		 * statements in this Document are yielded.
		 * 
		 * The method yields an object that contains the yielded statement,
		 * as well as a numeric level value that specifies the difference in 
		 * the number of nesting levels between the specified initialStatement
		 * and the yielded statement.
		 * 
		 * @param initialStatement A reference to the statement object
		 * from where the enumeration should begin.
		 * 
		 * @param includeInitial A boolean value indicating whether or
		 * not the specified initialStatement should also be returned
		 * as an element in the enumeration. If true, initialStatement
		 * must be non-null.
		 */
		*eachDescendant(
			initialStatement: Statement | null = null, 
			includeInitial?: boolean)
		{
			if (includeInitial)
			{
				if (!initialStatement)
					throw Exception.invalidArgument();
				
				yield { statement: initialStatement, level: 0 };
			}
			
			const initialChildren = this.getChildren(initialStatement);
			const self = this;
			
			// The initial level is 0 if the specified initialStatement is
			// null, because it indicates that the enumeration starts
			// at the root of the document.
			let level = initialStatement ? 1 : 0;
			
			function *recurse(statement: Statement): IterableIterator<{
				statement: Statement;
				level: number;
			}>
			{
				yield { statement, level };
				
				level++;
				
				for (const childStatement of self.getChildren(statement))
					yield *recurse(childStatement);
				
				level--;
			}
			
			for (const statement of initialChildren)
				yield *recurse(statement);
		}
		
		/**
		 * @deprecated
		 * Enumerates through each unique URI defined in this document,
		 * that are referenced within the descendants of the specified
		 * statement. If the parameters are null or omitted, all unique
		 * URIs referenced in this document are yielded.
		 * 
		 * @param initialStatement A reference to the statement object
		 * from where the enumeration should begin.
		 * 
		 * @param includeInitial A boolean value indicating whether or
		 * not the specified initialStatement should also be returned
		 * as an element in the enumeration. If true, initialStatement
		 * must be non-null.
		 */
		*eachUri(
			initialStatement: Statement | null = null,
			includeInitial?: boolean)
		{
			//
			// NOTE: Although this method is deprecated, if it were
			// to be revived, it would need to support "cruft".
			//
			
			const yieldedUris = new Set<string>();
			const iter = this.eachDescendant(initialStatement, includeInitial);
			
			for (const descendant of iter)
			{
				for (const span of descendant.statement.declarations)
				{
					for (const spine of span.factor())
					{
						const uri = Uri.clone(spine);
						const uriText = uri.toString();
						
						if (!yieldedUris.has(uriText))
						{
							yieldedUris.add(uriText);
							yield { uri, uriText };
						}
					}
				}
			}
		}
		
		/**
		 * Enumerates through each statement in the document,
		 * including comments and whitespace-only lines, starting
		 * at the specified statement or numeric position.
		 * 
		 * @yields The statements in the order that they appear
		 * in the document, excluding whitespace-only statements.
		 */
		*eachStatement(statement?: Statement | number)
		{
			const startNum = (() =>
			{
				if (!statement)
					return 0;
				
				if (statement instanceof Statement)
					return this.getLineNumber(statement);
				
				return statement;
			})();
			
			for (let i = startNum - 1; ++i < this.statements.length;)
				yield this.statements[i];
		}
		
		/**
		 * Reads the Statement at the given position.
		 * Negative numbers read Statement starting from the end of the document.
		 */
		read(lineNumber: number)
		{
			const lineBounded = DocumentUtil.applyBounds(lineNumber, this.statements.length);
			return this.statements[lineBounded];
		}
		
		/**
		 * Convenience method that converts a statement or it's index
		 * within this document to a statement object.
		 */
		private toStatement(statementOrIndex: Statement | number)
		{
			return statementOrIndex instanceof Statement ? 
				statementOrIndex :
				this.read(statementOrIndex);
		}
		
		/**
		 * Convenience method to quickly turn a value that may be
		 * a statement or a statement index, into a bounded statement 
		 * index.
		 */
		private toLineNumber(statementOrIndex: Statement | number)
		{
			return statementOrIndex instanceof Statement ?
				this.getLineNumber(statementOrIndex) :
				DocumentUtil.applyBounds(statementOrIndex, this.statements.length);
		}
		
		/** 
		 * Starts an edit transaction in the specified callback function.
		 * Edit transactions are used to synchronize changes made in
		 * an underlying file, typically done by a user in a text editing
		 * environment. System-initiated changes such as automated
		 * fixes, refactors, or renames do not go through this pathway.
		 * 
		 * @param editFn The callback function in which to perform
		 * document mutation operations.
		 * 
		 * @returns A promise that resolves any external document
		 * references added during the edit operation have been resolved.
		 * If no such references were added, a promise is returned that
		 * resolves immediately.
		 */
		async edit(editFn: (mutator: IDocumentMutator) => void)
		{
			if (this.inEdit)
				throw Exception.doubleTransaction();
			
			this.inEdit = true;
			const calls: TCallType[] = [];
			let hasDelete = false;
			let hasInsert = false;
			let hasUpdate = false;
			
			editFn({
				delete: (at = -1, count = 1) =>
				{
					if (count > 0)
					{
						calls.push(new DeleteCall(at, count));
						hasDelete = true;
					}
				},
				insert: (text: string, at = -1) =>
				{
					calls.push(new InsertCall(new Statement(this, text), at));
					hasInsert = true;
				},
				update: (text: string, at = -1) =>
				{
					const boundAt = DocumentUtil.applyBounds(at, this.statements.length);
					if (this.read(boundAt).sourceText !== text)
					{
						calls.push(new UpdateCall(new Statement(this, text), at));
						hasUpdate = true;
					}
				}
			});
			
			if (calls.length === 0)
			{
				this.inEdit = false;
				return;
			}
			
			const deletedUriSmts: UriStatement[] = [];
			const addedUriSmts: UriStatement[] = [];
			
			// Begin the algorithm that determines the changeset,
			// and runs the appropriate invalidation and revalidation
			// hooks. This is wrapped in an IIFE because we need to
			// perform finalization at the bottom (and there are early
			// return points throughout the algorithm.
			(() =>
			{
				const hasMixed =
					hasInsert && hasUpdate ||
					hasInsert && hasDelete ||
					hasUpdate && hasDelete;
				
				const boundAt = (call: TCallType) =>
					DocumentUtil.applyBounds(call.at, this.statements.length);
				
				
				const doDelete = (call: DeleteCall) =>
				{
					const at = boundAt(call);
					const smts = this.statements.splice(at, call.count);
					
					for (const smt of smts)
					{
						smt.dispose();
						
						if (smt.uri)
							deletedUriSmts.push(smt as UriStatement);
					}
					
					return smts;
				};
				
				const doInsert = (call: InsertCall) =>
				{
					if (call.at >= this.statements.length)
					{
						this.statements.push(call.smt);
					}
					else
					{
						const at = boundAt(call);
						this.statements.splice(at, 0, call.smt);
					}
					
					if (call.smt.uri)
						addedUriSmts.push(call.smt as UriStatement);
				};
				
				const doUpdate = (call: UpdateCall) =>
				{
					const at = boundAt(call);
					const existing = this.statements[at];
					if (existing.uri)
						deletedUriSmts.push(existing as UriStatement);
					
					this.statements[at] = call.smt;
					if (call.smt.uri)
						addedUriSmts.push(call.smt as UriStatement);
					
					existing.dispose();
				};
				
				if (!hasMixed)
				{
					// This handles the first optimization, which is the case where
					// the only kinds of mutations where updates, and no structural
					// changes occured. This handles typical "user is typing" cases.
					// Most edits will be caught here.
					if (hasUpdate)
					{
						// Sort the update calls by their index, and prune updates
						// that would be overridden in a following call.
						//! Remove this unnecessary variable once we can do that
						//! without ESLint complaining (unnecessary brackets).
						const updateCallsTyped = calls as UpdateCall[];
						const updateCalls = updateCallsTyped
							.sort((a, b) => a.at - b.at)
							.filter((call, i) => i >= calls.length - 1 || call.at !== calls[i + 1].at);
						
						const oldStatements = updateCalls.map(c => this.statements[c.at]);
						const newStatements = updateCalls.map(c => c.smt);
						const indexes = Object.freeze(updateCalls.map(c => c.at));
						
						const noStructuralChanges = oldStatements.every((oldSmt, idx) =>
						{
							const newSmt = newStatements[idx];
							return oldSmt.indent === newSmt.indent ||
								oldSmt.isNoop && newSmt.isNoop;
						});
						
						if (noStructuralChanges)
						{
							const hasOpStatements =
								oldStatements.some(smt => !smt.isNoop) ||
								newStatements.some(smt => !smt.isNoop);
							
							if (hasOpStatements)
							{
								// Tell subscribers to blow away all the old statements.
								this.program.cause(new CauseInvalidate(
									this,
									oldStatements,
									indexes));
							}
							
							// Run the actual mutations
							for (const updateCall of updateCalls)
								doUpdate(updateCall);
							
							if (hasOpStatements)
							{
								// Tell subscribers what changed
								this.program.cause(new CauseRevalidate(
									this, 
									newStatements,
									indexes));
							}
							
							return;
						}
					}
				
					// This handles the second optimization, which is the case where
					// only deletes occured, and none of the deleted statements have any
					// descendants. This will handle the majority of "delete a line" cases.
					if (hasDelete)
					{
						const deleteCalls = <DeleteCall[]>calls;
						const deadStatements: Statement[] = [];
						const deadIndexes: number[] = [];
						let hasOpStatements = false;
						
						forCalls:
						for (const deleteCall of deleteCalls)
						{
							for (let i = -1; ++i < deleteCall.count;)
							{
								const deadSmt = this.statements[deleteCall.at + i];
								if (this.hasDescendants(deadSmt))
								{
									deadStatements.length = 0;
									break forCalls;
								}
								
								deadStatements.push(deadSmt);
								deadIndexes.push(i);
								
								if (!deadSmt.isNoop)
									hasOpStatements = true;
							}
						}
						
						if (deadStatements.length > 0)
						{
							// Tell subscribers to blow away all the old statements.
							// An edit transaction can be avoided completely in the case
							// when the only statements that were deleted were noops.
							if (hasOpStatements)
								this.program.cause(new CauseInvalidate(
									this,
									deadStatements,
									deadIndexes));
							
							// Run the actual mutations
							deleteCalls.forEach(doDelete);
							
							// Run an empty revalidation hook, to comply with the
							// rule that for every invalidation hook, there is always a
							// corresponding revalidation hook.
							if (hasOpStatements)
								this.program.cause(new CauseRevalidate(this, [], []));
							
							return;
						}
					}
					
					// This handles the third optimization, which is the case
					// where there are only noop statements being inserted
					// into the document.
					if (hasInsert)
					{
						const insertCalls = <InsertCall[]>calls;
						if (insertCalls.every(call => call.smt.isNoop))
						{
							insertCalls.forEach(doInsert);
							return;
						}
					}
				}
				
				// At this point, the checks to see if we can get away with
				// performing simplistic updates have failed. So we need
				// to resort to invalidating and revalidating larger swaths 
				// of statements.
				
				// Stores an array of statements whose descendant statements
				// should be invalidated. 
				//const invalidatedParents: { at: number; parent: Statement; }[] = [];
				const invalidatedParents = new Map<number, Statement>();
				
				// Stores a value indicating whether the entire document
				// needs to be invalidated.
				let mustInvalidateDoc = false;
				
				// The first step is to go through all the statements, and compute the 
				// set of parent statements from where invalidation should originate.
				// In the majority of cases, this will only be one single statement object.
				for (const call of calls)
				{
					const atBounded = DocumentUtil.applyBounds(call.at, this.statements.length);
					
					if (call instanceof DeleteCall)
					{
						const deletedStatement = this.statements[atBounded];
						if (deletedStatement.isNoop)
							continue;
						
						const parent = this.getParent(atBounded);
						
						if (parent instanceof Statement)
						{
							invalidatedParents.set(call.at, parent);
						}
						else if (parent instanceof Document)
						{
							mustInvalidateDoc = true;
							break;
						}
						else throw Exception.unknownState();
					}
					else
					{
						if (call instanceof InsertCall)
						{
							if (call.smt.isNoop)
								continue;
						}
						else if (call instanceof UpdateCall)
						{
							const oldStatement = this.statements[atBounded];
							
							if (oldStatement.isNoop && call.smt.isNoop)
								continue;
						}
						
						const parent = this.getParentFromPosition(
							call.at,
							call.smt.indent);
						
						if (parent instanceof Statement)
						{
							invalidatedParents.set(call.at, parent);
						}
						else if (parent === this)
						{
							mustInvalidateDoc = true;
							break;
						}
					}
				}
				
				// Although unclear how this could happen, if there
				// are no invalidated parents, we can safely return.
				if (!mustInvalidateDoc && invalidatedParents.size === 0)
					return;
				
				// Prune any redundant parents. A parent is redundant
				// when it's a descendant of another parent in the 
				// invalidation array. The algorithm below compares the
				// statement ancestries of each possible pairs of invalidated
				// parents, and splices invalidated parents out of the 
				// array in the case when the parent is parented by some
				// other invalidated parent in the invalidatedParents array.
				const invalidatedAncestries: Statement[][] = [];
				
				for (const at of invalidatedParents.keys())
				{
					const ancestry = this.getAncestry(at);
					if (ancestry)
						invalidatedAncestries.push(ancestry);
				}
				
				if (invalidatedAncestries.length > 1)
				{
					for (let i = invalidatedAncestries.length; i--;)
					{
						const ancestryA = invalidatedAncestries[i];
						
						for (let n = i; n--;)
						{
							const ancestryB = invalidatedAncestries[n];
							
							if (ancestryA.length === ancestryB.length)
								continue;
							
							const aLessB = ancestryA.length < ancestryB.length;
							const ancestryShort = aLessB ? ancestryA : ancestryB;
							const ancestryLong = aLessB ? ancestryB : ancestryA;
							
							if (ancestryShort.every((smt, idx) => smt === ancestryLong[idx]))
								invalidatedAncestries.splice(aLessB ? n : i, 1);
						}
					}
				}
				
				const parents = mustInvalidateDoc ? [] : Array.from(invalidatedParents.values());
				const indexes = mustInvalidateDoc ? [] : Array.from(invalidatedParents.keys());
				
				// Notify observers of the Invalidate hook to invalidate the
				// descendants of the specified set of parent statements.
				this.program.cause(new CauseInvalidate(this, parents, indexes));
				
				
				const deletedStatements: Statement[] = [];
				
				// Perform the document mutations.
				for (const call of calls)
				{
					if (call instanceof DeleteCall)
						deletedStatements.push(...doDelete(call));
					
					else if (call instanceof InsertCall)
						doInsert(call);
					
					else if (call instanceof UpdateCall)
						doUpdate(call);
				}
				
				// Remove any deleted statements from the invalidatedParents map
				for (const deletedStatement of deletedStatements)
					for (const [at, parentStatement] of invalidatedParents)
						if (deletedStatement === parentStatement)
							invalidatedParents.delete(at);
				
				// Notify observers of the Revalidate hook to update the
				// descendants of the specified set of parent statements.
				this.program.cause(new CauseRevalidate(
					this, 
					Array.from(invalidatedParents.values()),
					Array.from(invalidatedParents.keys())
				));				
			})();
			
			// Perform a debug-time check to be sure that there are
			// no disposed statements left hanging around in the document
			// after the edit transaction has completed.
			if ("DEBUG")
				for (const smt of this.statements)
					if (smt.isDisposed)
						throw Exception.unknownState();
			
			// Clean out any type cache
			this._types = null;
			
			// Tell subscribers that the edit transaction completed.
			this.program.cause(new CauseEditComplete(this));
			
			this._version = VersionStamp.next();
			this.inEdit = false;
			
			if (addedUriSmts.length + deletedUriSmts.length > 0)
				await this.updateReferences(deletedUriSmts, addedUriSmts);
		}
		
		/**
		 * Executes a complete edit transaction, applying the series
		 * of edits specified in the `edits` parameter. 
		 * 
		 * @returns A promise that resolves any external document
		 * references added during the edit operation have been resolved.
		 * If no such references were added, a promise is returned that
		 * resolves immediately.
		 */
		async editAtomic(edits: IDocumentEdit[])
		{
			return this.edit(statements =>
			{
				for (const editInfo of edits)
				{
					if (!editInfo.range)
						throw new TypeError("No range included.");
					
					const startLine = editInfo.range.startLineNumber;
					const endLine = editInfo.range.endLineNumber;
					
					const startChar = editInfo.range.startColumn;
					const endChar = editInfo.range.endColumn;
					
					const startLineText = this.read(startLine).sourceText;
					const endLineText = this.read(endLine).sourceText;
					
					const prefixSegment = startLineText.slice(0, startChar);
					const suffixSegment = endLineText.slice(endChar);
					
					const segments = editInfo.text.split("\n");
					const pastCount = endLine - startLine + 1;
					const presentCount = segments.length;
					const deltaCount = presentCount - pastCount;
					
					// Detect the pure update cases
					if (deltaCount === 0)
					{
						if (pastCount === 1)
						{
							statements.update(
								prefixSegment + editInfo.text + suffixSegment, 
								startLine);
						}
						else 
						{
							statements.update(prefixSegment + segments[0], startLine);
							
							for (let i = startLine; i <= endLine; i++)
							{
								statements.update(
									prefixSegment + segments[i] + suffixSegment,
									startLine);
							}
							
							statements.update(segments.slice(-1)[0] + suffixSegment, endLine);
						}
						
						continue;
					}
					
					// Detect the pure delete cases
					if (deltaCount < 0)
					{
						const deleteCount = deltaCount * -1;
						
						
						// Detect a delete ranging from the end of 
						// one line, to the end of a successive line
						if (startChar === startLineText.length)
							if (endChar === endLineText.length)
							{
								statements.delete(startLine + 1, deleteCount);
								continue;
							}
						
						// Detect a delete ranging from the start of
						// one line to the start of a successive line
						if (startChar + endChar === 0)
						{
							statements.delete(startLine, deleteCount);
							continue;
						}
					}
					
					// Detect the pure insert cases
					if (deltaCount > 0)
					{
						// Cursor is at the end of the line, and the first line of the 
						// inserted content is empty (most likely, enter was pressed)						
						if (startChar === startLineText.length && segments[0] === "")
						{
							for (let i = 0; ++i < segments.length;)
								statements.insert(segments[i], startLine + i);
							
							continue;
						}
						
						// Cursor is at the beginning of the line, and the
						// last line of the inserted content is empty.
						if (startChar === 0 && segments.slice(-1)[0] === "")
						{
							for (let i = -1; ++i < segments.length - 1;)
								statements.insert(segments[i], startLine + i);
							
							continue;
						}
					}
					
					// This is the "fallback" behavior -- simply delete everything
					// that is old, and insert everything that is new.
					const deleteCount = endLine - startLine + 1;
					statements.delete(startLine, deleteCount);
					
					const insertLines = segments.slice();
					insertLines[0] = prefixSegment + insertLines[0];
					insertLines[insertLines.length - 1] += suffixSegment;
					
					for (let i = -1; ++i < insertLines.length;)
						statements.insert(insertLines[i], startLine + i);
				}
			});
		}
		
		/**
		 * A state variable that stores whether an
		 * edit transaction is currently underway.
		 */
		private inEdit = false;
		
		/**
		 * Returns a formatted version of the Document.
		 */
		toString(keepOriginalFormatting?: boolean)
		{
			const lines: string[] = [];
			
			if (keepOriginalFormatting)
			{
				for (const statement of this.statements)
					lines.push(statement.sourceText);
			}
			else for (const { statement, level } of this.eachDescendant())
			{
				const indent = Syntax.tab.repeat(level);
				lines.push(indent + statement.toString());
			}
			
			return lines.join("\n");
		}
	}
}
