import { exec } from "child_process";

export function contains(original: string, substr: string): boolean {
  return original.indexOf(substr) >= 0;
}

export function strip(s: string): string {
  return s.replace(new RegExp("^['\".]+"), "");
}

export function execShellCommand(
  cmd: string,
  projectRoot: string
): Promise<string> {
  return new Promise((resolve, _reject) => {
    exec(
      cmd,
      {
        cwd: projectRoot
      },
      (error, stdout, stderr) => {
        if (error) {
          console.warn(error);
        }
        resolve(stdout ? stdout : stderr);
      }
    );
  });
}
