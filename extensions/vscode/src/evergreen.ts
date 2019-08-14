import {
  TextDocument,
  Definition,
  Position,
  DiagnosticSeverity,
  IConnection,
  Diagnostic,
  CompletionItemKind,
  CompletionItem,
  Location
} from "vscode-languageserver";
import * as YAML from "yaml";

import { contains, execShellCommand } from "./util";

export default class EvergreenDocument {
  private connection: IConnection;
  private document: TextDocument;
  private content: string[] | null = null;
  private yamlDoc: any = null;

  constructor(document: TextDocument, connection: IConnection) {
    this.document = document;
    this.connection = connection;
  }

  private isTasksContext(pos: Position): boolean {
    const allLines = this.contentLines();
    let selectedLine = allLines[pos.line];

    if (contains(selectedLine, "- func:")) {
      return false;
    }
    if (contains(selectedLine, "task:") || contains(selectedLine, "tasks:")) {
      return true;
    }
    let index = pos.line;
    while (contains(selectedLine, "-")) {
      selectedLine = allLines[index];
      index--;
    }

    return (
      contains(selectedLine, "task:") ||
      contains(selectedLine, "tasks:") ||
      contains(selectedLine, "depends_on")
    );
  }

  public validate(): Promise<void> {
    return new Promise(async (res, _rej) => {
      const rawOutput: string = await getEvgErrorLines(this.document.uri);
      const diagnostics: Diagnostic[] = rawOutput
        .split(/\r?\n/)
        .filter(l => contains(l, "ERROR"))
        .map(errLine => {
          let pattern = /line (\d+): (.*)/g;
          let match = pattern.exec(errLine);
          let lineNum = 0;
          let message = "";
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
        });
      this.connection.sendDiagnostics({ uri: this.document.uri, diagnostics });
      res();
    });
  }

  private yaml(): any {
    if (this.yamlDoc === null) {
      const fullDocument = JSON.stringify(this.document);
      const evergreenContent = JSON.parse(fullDocument)["_content"];
      this.yamlDoc = YAML.parse(evergreenContent, { merge: true });
    }
    return this.yamlDoc;
  }

  private contentLines(): string[] {
    if (this.content === null) {
      const fullDocument = JSON.stringify(this.document);
      const evergreenContent = JSON.parse(fullDocument)["_content"];
      this.content = evergreenContent.split(/\r?\n/);
    }
    return this.content;
  }

  public definition(pos: Position): Definition {
    if (this.isTasksContext(pos)) {
      return this.taskDefinition(pos);
    }
    return this.functionDefinition(pos);
  }
  private taskDefinition(pos: Position): Definition {
    const allLines = this.contentLines();

    const selectedLine = allLines[pos.line];
    const pattern = /\s*-\s*(.*)$|\s*-\s*(.*)|\s*tasks?\s*:\s*(.*)/g;
    const match = pattern.exec(selectedLine);
    if (match === null) {
      // didn't click on a task reference
      return [];
    }
    // othetwise we did, let's grab the task name
    const taskName = match[1].replace(/"/g, "");
    const rootLevelTaskPattern = /^tasks:.*$/g;

    let rootIndex = -1;
    for (let i = 0; i < allLines.length; i++) {
      const line = allLines[i];
      if (rootLevelTaskPattern.exec(line) !== null) {
        rootIndex = i;
        break;
      }
    }

    const definitionPattern = new RegExp(`^- name: ${taskName}`);
    for (let i = rootIndex; i < allLines.length; i++) {
      const line = allLines[i].replace(/"/g, "");
      const startIndex = line.indexOf(taskName);
      if (startIndex === -1) {
        continue;
      }
      const endIndex = startIndex + taskName.length;
      if (definitionPattern.exec(line) !== null) {
        return {
          uri: this.document.uri,
          range: {
            start: {
              line: i,
              character: startIndex
            },
            end: {
              line: i,
              character: endIndex
            }
          }
        };
      }
    }

    return [];
  }

  public onReferences(pos: Position): Location[] {
    if (this.isTasksContext(pos)) {
      return this.onTaskReferences(pos);
    }
    return this.onFunctionReferences(pos);
  }

  private onTaskReferences(pos: Position): Location[] {
    return [];
  }

  private onFunctionReferences(pos: Position): Location[] {
    const allLines = this.contentLines();
    const selectedLine = allLines[pos.line];
    const locations: Location[] = [];

    const funcNames = getFullFunctionNames(selectedLine);

    if (funcNames.length === 0) {
      return [];
    }

    for (let i = 0; i < allLines.length; i++) {
      const currentLine = allLines[i];
      // find every function usage that is using the selected function
      if (contains(currentLine, "- func") || contains(currentLine, "- *")) {
        // it's a usage

        for (let f of funcNames) {
          if (!contains(currentLine, f)) {
            continue;
          }
          const targetFunc = getFullFunctionUsageName(currentLine);
          const startIndex = currentLine.indexOf(targetFunc);
          if (startIndex === -1) {
            continue;
          }
          const endIndex = startIndex + targetFunc.length;
          locations.push({
            uri: this.document.uri,
            range: {
              start: {
                line: i,
                character: startIndex
              },
              end: {
                line: i,
                character: endIndex
              }
            }
          });
        }
      }
    }
    return locations;
  }

  public onCompletion(pos: Position): CompletionItem[] {
    if (this.isTasksContext(pos)) {
      return this.onTaskCompletion(pos);
    }
    return this.onFunctionCompletion(pos);
  }

  private onTaskCompletion(pos: Position): CompletionItem[] {
    const allLines = this.contentLines();
    const currentLine = allLines[pos.line];

    if (contains(currentLine, "- ") || contains(currentLine, "task")) {
      const taskNames = this.tasks().map(task => task["name"]);
      const taskGroupNames = this.taskGroups().map(task => task["name"]);
      return taskNames.concat(taskGroupNames).map((taskName, i) => {
        return {
          label: taskName,
          kind: CompletionItemKind.Variable,
          data: i
        };
      });
    }
    return [];
  }

  private onFunctionCompletion(pos: Position): CompletionItem[] {
    const allLines = this.contentLines();
    const currentLine = allLines[pos.line];
    if (contains(currentLine, "- func:")) {
      return this.functions().map((functionName, i) => {
        return {
          label: `"${functionName}"`,
          kind: CompletionItemKind.Function,
          data: i
        };
      });
    } else if (contains(currentLine, "*") && !contains(currentLine, "<<")) {
      return getAllFunctionNames(allLines)
        .map(s => s.substring(1))
        .map((functionName, i) => {
          return {
            label: functionName,
            kind: CompletionItemKind.Function,
            data: i
          };
        });
    }
    return [];
  }

  private functionDefinition(pos: Position): Definition {
    const allLines = this.contentLines();
    const selectedLine = allLines[pos.line];
    const functionUsageName = getFullFunctionUsageName(selectedLine);
    const allFuncs: string[] = this.functions().concat(
      getAllFunctionNames(allLines)
    );

    if (allFuncs.indexOf(functionUsageName) >= 0) {
      for (let i = 0; i < allLines.length; i++) {
        const currentLine = allLines[i];
        const startIndex = currentLine.indexOf(
          toDefinitionName(functionUsageName)
        );
        if (startIndex === -1) {
          continue;
        }
        const endIndex = startIndex + functionUsageName.length;
        return {
          uri: this.document.uri,
          range: {
            start: {
              line: i,
              character: startIndex
            },
            end: {
              line: i,
              character: endIndex
            }
          }
        };
      }
    }
    return [];
  }

  public functions(): string[] {
    return Object.keys(this.yaml().functions);
  }

  public tasks(): string[] {
    return this.yaml().tasks;
  }

  public buildVariants(): string[] {
    return this.yaml().buildvariants;
  }

  public taskGroups(): string[] {
    return this.yaml().task_groups;
  }
}
function toDefinitionName(usageName: string): string {
  if (contains(usageName, "*")) {
    return usageName.replace("*", "&");
  }
  return usageName;
}

function getFullFunctionUsageName(fullLine: string): string {
  const pattern1 = /.*- func:\s*\"?([a-zA-Z_\-0-9\s]+)\"?.*/g;
  const pattern2 = /.*\s\*(.*)/g;
  const match1 = pattern1.exec(fullLine);
  if (match1 !== null && match1.length === 2) {
    return match1[1];
  }
  const match2 = pattern2.exec(fullLine);
  if (match2 !== null && match2.length === 2) {
    return `*${match2[1]}`;
  }
  return "";
}

function getAllFunctionNames(lines: string[]): string[] {
  const pattern = /.*\s+\".*\".*\s+&([a-zA-Z0-9_-]+)/g;
  return lines
    .map(line => {
      const match = pattern.exec(line);
      if (match !== null && match.length === 2) {
        return `*${match[1]}`;
      }
      return "";
    })
    .filter(line => line !== "");
}

function validateEvg(filePath: string): Promise<string> {
  return execShellCommand(`evergreen validate ${filePath}`, "/");
}

function getEvgErrorLines(filePath: string): Promise<string> {
  if (filePath.startsWith("file://")) {
    filePath = filePath.replace("file://", "");
  }
  return validateEvg(filePath);
}

function getFullFunctionNames(fullLine: string): string[] {
  const match = /.*"(.*)":(.*&(.*))?/g.exec(fullLine);

  if (match == null) {
    return [];
  }
  if (match.length == 2) {
    return [match[1]];
  } else if (match.length == 4) {
    return [match[1], `*${match[3]}`];
  }
  return [];
}
