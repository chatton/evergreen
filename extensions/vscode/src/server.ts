import {
  createConnection,
  TextDocuments,
  TextDocument,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  CompletionItem,
  TextDocumentPositionParams,
  ReferenceParams,
  Location,
  Definition
} from "vscode-languageserver";

import EvergreenDocument from "./evergreen";

let connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager. The text document manager
// supports full document sync only
let documents: TextDocuments = new TextDocuments();

let hasConfigurationCapability: boolean = false;
let hasWorkspaceFolderCapability: boolean = false;
let hasDiagnosticRelatedInformationCapability: boolean = false;

connection.onInitialize((params: InitializeParams) => {
  let capabilities = params.capabilities;

  // Does the client support the `workspace/configuration` request?
  // If not, we will fall back using global settings
  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );
  hasDiagnosticRelatedInformationCapability = !!(
    capabilities.textDocument &&
    capabilities.textDocument.publishDiagnostics &&
    capabilities.textDocument.publishDiagnostics.relatedInformation
  );

  return {
    capabilities: {
      textDocumentSync: documents.syncKind,
      // Tell the client that the server supports code completion
      completionProvider: {
        resolveProvider: true
      },
      referencesProvider: true,
      definitionProvider: true
    }
  };
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    // Register for all configuration changes.
    connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined
    );
  }
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders(_event => {
      connection.console.log("Workspace folder change event received.");
    });
  }
});

// The settings interface describe the server relevant settings part
interface Settings {
  evgSettings: EvergreenSettings;
}

// The example settings
interface EvergreenSettings {
  projectRoot: string;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
let globalSettings: EvergreenSettings;

// Cache the settings of all open documents
let documentSettings: Map<string, Thenable<EvergreenSettings>> = new Map();

connection.onDidChangeConfiguration(change => {
  let settings = <Settings>change.settings;

  if (hasConfigurationCapability) {
    // Reset all cached document settings
    documentSettings.clear();
  } else {
    globalSettings = settings.evgSettings;
  }

  // Revalidate all open text documents
  documents
    .all()
    .map(doc => new EvergreenDocument(doc, connection))
    .forEach(evg => evg.validate());
});

// Only keep settings for open documents
documents.onDidClose(e => {
  documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
  new EvergreenDocument(change.document, connection).validate();
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
  (textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
    let doc: TextDocument | undefined = documents.get(
      textDocumentPosition.textDocument.uri
    );
    if (!doc) {
      return [];
    }
    const evg = new EvergreenDocument(doc, connection);
    return evg.onCompletion(textDocumentPosition.position);
  }
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
  (item: CompletionItem): CompletionItem => {
    return item;
  }
);
connection.onDefinition(
  (positionParams: TextDocumentPositionParams): Definition => {
    const doc = documents.get(positionParams.textDocument.uri);
    const evg = new EvergreenDocument(doc, connection);
    return evg.definition(positionParams.position);
  }
);

connection.onReferences(
  (refParams: ReferenceParams): Location[] => {
    let doc: TextDocument | undefined = documents.get(
      refParams.textDocument.uri
    );
    if (!doc) {
      return [];
    }
    const evg = new EvergreenDocument(doc, connection);
    return evg.onReferences(refParams.position);
  }
);

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
