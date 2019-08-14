import * as path from "path";
import { workspace, ExtensionContext, commands, window } from "vscode";
import { execShellCommand, contains, strip } from "./util";
import * as YAML from "yaml";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from "vscode-languageclient";

let client: LanguageClient;

// TODO: Support tags - it is possible to specify build variants for a task by using tags, this is currently ignored.
function getBuildVariantsForTask(selectedTask: string, yamlDoc: any): string[] {
  const buildVariantsTaskIsIn = [];

  // sanitize all the names, we don't care about ", ' or . in the names - they are all equivalent
  const allTaskGroups = yamlDoc["task_groups"].map(tg => {
    tg["name"] = strip(tg["name"]);
    return tg;
  });

  for (let bv of yamlDoc["buildvariants"]) {
    const tasksInBv = bv["tasks"];
    const taskNames = [];

    // we want the name, each task could be a string or an object with a name field
    for (let taskOrName of tasksInBv) {
      if (taskOrName["name"]) {
        taskNames.push(strip(taskOrName["name"]));
      } else {
        taskNames.push(strip(taskOrName));
      }
    }
    const allTaskNames = Array.from(taskNames);
    for (let taskOrTaskGroup of taskNames) {
      const taskGroupNames = allTaskGroups.map(t => t["name"]);
      const isTaskGroup = taskGroupNames.indexOf(taskOrTaskGroup) >= 0;

      // this one is a task group and not a task, so we should add all the tasks from this task group.
      if (isTaskGroup) {
        const taskGroup = allTaskGroups.filter(
          tg => strip(tg["name"]) === taskOrTaskGroup
        )[0];
        // again it could be an object or a name
        allTaskNames.push(
          ...taskGroup["tasks"].map(t => {
            if (t["name"]) {
              return strip(t["name"]);
            } else {
              return strip(t);
            }
          })
        );
      } else {
        // it's a task not a task group, just add it
        allTaskNames.push(strip(taskOrTaskGroup));
      }
    }
    // if the task is in the possible list of tasks that has been built up then this is a build variant that will be valid for the given task
    if (allTaskNames.indexOf(strip(selectedTask)) >= 0) {
      buildVariantsTaskIsIn.push(strip(bv["name"]));
    }
  }

  return buildVariantsTaskIsIn;
}
function addHandler(context: ExtensionContext) {
  context.subscriptions.push(
    commands.registerCommand("evgExtension.runTask", () => {
      const quickPick = window.createQuickPick();
      const doc = window.activeTextEditor.document;
      const fullText = doc.getText();
      const yamlDoc = YAML.parse(fullText, { merge: true });

      quickPick.items = yamlDoc.tasks.map(t => {
        const task = { label: t["name"] };
        return task;
      });
      quickPick.onDidAccept(() => {
        const selectedTask = quickPick.activeItems[0].label;
        const buildVariants = getBuildVariantsForTask(selectedTask, yamlDoc);
        const buildVariantQuickPick = window.createQuickPick();
        buildVariantQuickPick.items = buildVariants.map(buildVariant => {
          return {
            label: buildVariant
          };
        });
        buildVariantQuickPick.show();

        buildVariantQuickPick.onDidAccept(() => {
          const selectedBuildVariant =
            buildVariantQuickPick.activeItems[0].label;

          const projectRoot = workspace
            .getConfiguration("evergreen")
            .get<string>("projectRoot");

          const projectName = workspace
            .getConfiguration("evergreen")
            .get<string>("projectName");

          if (!projectRoot || !projectName) {
            window.showErrorMessage(
              "Unable to dispatch task until `evergreen.projectRoot` and `evergreen.projectName` are configured"
            );
            return;
          }

          const cmd = `evergreen patch -p ${projectName} -t ${selectedTask} -v ${selectedBuildVariant} -f -y -d "Task created from VSCode"`;
          window.showInformationMessage(
            `Creating evergreen patch with task ${selectedTask} and build variant ${selectedBuildVariant}`
          );
          buildVariantQuickPick.hide();

          execShellCommand(cmd, projectRoot).then(output => {
            const pattern = /\s*Build : (.*)$/gm;
            const match = pattern.exec(output);
            if (match !== null) {
              const link = match[1];
              window.showInformationMessage(link);
            } else {
              window.showErrorMessage(
                `Failed to create patch ${output}. Command ran was ${cmd}`
              );
            }
          });
        });
      });
      quickPick.show();
    })
  );
}

export function activate(context: ExtensionContext) {
  //   context.globalState.update("evergreen.projectRoot");
  // The server is implemented in node
  let serverModule = context.asAbsolutePath(path.join("out", "server.js"));
  // The debug options for the server
  // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
  let debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  let serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: debugOptions
    }
  };

  // Options to control the language client
  let clientOptions: LanguageClientOptions = {
    // Register the server for plain text documents
    documentSelector: [
      { scheme: "file", pattern: "**/*.evergreen.yaml" },
      { scheme: "file", pattern: "**/*.evergreen.yml" }
    ],
    // documentSelector: [{ scheme: 'file', language: 'plaintext' }],
    synchronize: {
      // Notify the server about file changes to '.clientrc files contained in the workspace
      fileEvents: workspace.createFileSystemWatcher("**/.clientrc")
    }
  };

  // Create the language client and start the client.
  client = new LanguageClient(
    "Evergreen Server",
    "Evergreen Server",
    serverOptions,
    clientOptions
  );

  addHandler(context);

  // Start the client. This will also launch the server
  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
