# Overview

The evergreen-ci extention allows basic navigation and code completion for `evergreen.yaml` project files.

- Jump to function usages with with `Shift + F12`.
- Jump to function definition with `F12`.
- Auto complete task and function declarations with `Control + Space`.

Note: Currently only partial support for task auto completion is available.

For more information about Evergreen, you can look [here](https://github.com/evergreen-ci/evergreen/wiki)

# Available Commands

- `Evg: Run Task`: This command allows you to specify a `Task` and a `Build Variant` and will create an `Evergreen` patch for this task.

# Requirements

The evergreen-ci extention makes use of the `evergreen cli tool` which can be found [here](https://github.com/evergreen-ci/evergreen/wiki/Using-the-Command-Line-Tool)

In order to make use of document validation and `Evg: Run Task`, you will need to have the cli tool configured.

# Supported VS Code Settings

- `evergreen.projectName`: This is the name of the evergreen project.
- `evergreen.projectRoot`: This is the absolute path the directory the `evergreen.yaml` file is located in your project. ( required for `Evg: Run Task` and file validation)
