/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

// import { Range } from 'vscode';

import {
	createConnection,
	TextDocuments,
	TextDocument,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	Position
} from 'vscode-languageserver';

import { execSync } from 'child_process'
import * as YAML from 'yaml'


// Create a connection for the server. The connection uses Node's IPC as a transport.
// Also include all preview / proposed LSP features.
let connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager. The text document manager
// supports full document sync only
let documents: TextDocuments = new TextDocuments();

let hasConfigurationCapability: boolean = false;
let hasWorkspaceFolderCapability: boolean = false;
let hasDiagnosticRelatedInformationCapability: boolean = false;

connection.onInitialize((params: InitializeParams) => {
	// let capabilities = params.capabilities;

	// Does the client support the `workspace/configuration` request?
	// If not, we will fall back using global settings
	// hasConfigurationCapability = !!(
	// 	capabilities.workspace && !!capabilities.workspace.configuration
	// );
	// hasWorkspaceFolderCapability = !!(
	// 	capabilities.workspace && !!capabilities.workspace.workspaceFolders
	// );
	// hasDiagnosticRelatedInformationCapability = !!(
	// 	capabilities.textDocument &&
	// 	capabilities.textDocument.publishDiagnostics &&
	// 	capabilities.textDocument.publishDiagnostics.relatedInformation
	// );

	return {
		capabilities: {
			textDocumentSync: documents.syncKind,
			// Tell the client that the server supports code completion
			completionProvider: {
				resolveProvider: true
			}
		}
	};
});

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
	}
});

// The example settings
interface ExampleSettings {
	maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: ExampleSettings = { maxNumberOfProblems: 1000 };
let globalSettings: ExampleSettings = defaultSettings;

// Cache the settings of all open documents
let documentSettings: Map<string, Thenable<ExampleSettings>> = new Map();

connection.onDidChangeConfiguration(change => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = <ExampleSettings>(
			(change.settings.languageServerExample || defaultSettings)
		);
	}

	// Revalidate all open text documents
	documents.all().forEach(validateTextDocument);
});

// function getDocumentSettings(resource: string): Thenable<ExampleSettings> {
// 	if (!hasConfigurationCapability) {
// 		return Promise.resolve(globalSettings);
// 	}
// 	let result = documentSettings.get(resource);
// 	if (!result) {
// 		result = connection.workspace.getConfiguration({
// 			scopeUri: resource,
// 			section: 'languageServerExample'
// 		});
// 		documentSettings.set(resource, result);
// 	}
// 	return result;
// }

// Only keep settings for open documents
documents.onDidClose(e => {
	documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
	validateTextDocument(change.document);
});

function getCliOutput(cmd: string) : string {
	return execSync(cmd).toString();
}

function validateEvg(filePath: string){
	return getCliOutput(`evergreen validate ${filePath}`);
}

function contains(original: string, substr: string): boolean {
	return original.indexOf(substr) >= 0;
}

function getEvgErrorLines(filePath: string): string[] {
	if(filePath.startsWith("file://")){
		filePath = filePath.replace("file://", '');
	}
	let output = validateEvg(filePath)
	return output.split(/\r?\n/).filter(l => contains(l, "ERROR"));
}

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
	const diagnostics: Diagnostic[] = getEvgErrorLines(textDocument.uri).map(errLine => {
		let pattern = /line (\d+): (.*)/g
		let match = pattern.exec(errLine);
		let lineNum = 0;
		let message = ""
		if (match != null) {
			lineNum = parseInt(match[1]);
			message = match[2];
		}

		return {
			severity: DiagnosticSeverity.Error,
			range: {
				start: Position.create(lineNum, 0),
				end: Position.create(lineNum, Number.MAX_VALUE)
			},
			message,
			source: errLine
		};
	})
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles(_change => {
	// Monitored files have change in VSCode
	connection.console.log('We received an file change event');
});


function asYAML(doc: TextDocument): any {
	const fullDocument = JSON.stringify(doc);
	const evergreenContent = JSON.parse(fullDocument)["_content"];
	// merge true enables support for >> yaml syntax
	const yamlDoc = YAML.parse(evergreenContent, { merge: true });
	return yamlDoc;
}

// This handler provides the initial list of the completion items.
connection.onCompletion(
	(textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
		let doc: TextDocument | undefined = documents.get(textDocumentPosition.textDocument.uri);
		if(!doc){
			return [];
		}

		// const pos = textDocumentPosition.position;
		// const currentLineText = doc.getText(new Range(pos.line, 0, pos.line, Number.MAX_VALUE));
		
		return Object.keys(asYAML(doc).functions).map((functionName, i) => {
			return {
				label: functionName,
				kind: CompletionItemKind.Text,
				data: i
			}
		})
	}
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
	(item: CompletionItem): CompletionItem => {
		if (item.data === 1) {
			item.detail = 'TypeScript details';
			item.documentation = 'TypeScript documentation';
		} else if (item.data === 2) {
			item.detail = 'JavaScript details';
			item.documentation = 'JavaScript documentation';
		}
		return item;
	}
);

/*
connection.onDidOpenTextDocument((params) => {
	// A text document got opened in VSCode.
	// params.uri uniquely identifies the document. For documents store on disk this is a file URI.
	// params.text the initial full content of the document.
	connection.console.log(`${params.textDocument.uri} opened.`);
});
connection.onDidChangeTextDocument((params) => {
	// The content of a text document did change in VSCode.
	// params.uri uniquely identifies the document.
	// params.contentChanges describe the content changes to the document.
	connection.console.log(`${params.textDocument.uri} changed: ${JSON.stringify(params.contentChanges)}`);
});
connection.onDidCloseTextDocument((params) => {
	// A text document got closed in VSCode.
	// params.uri uniquely identifies the document.
	connection.console.log(`${params.textDocument.uri} closed.`);
});
*/

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
