import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { execSync, spawn } from "child_process";
import { parse as parseJSONC } from "jsonc-parser";

type DevcontainerConfig = {
  image?: string;
  remoteUser?: string;
  dockerFile?: string;
  postCreateCommand?: string | string[];
};

function getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0];
}

function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || "";
}

function getDevcontainerPath(wsFsPath: string): string {
  return path.join(wsFsPath, ".devcontainer", "devcontainer.json");
}

function readDevcontainerConfig(wsFsPath: string): DevcontainerConfig {
  const devcontainerPath = getDevcontainerPath(wsFsPath);
  if (!fs.existsSync(devcontainerPath)) {
    throw new Error("No devcontainer.json found");
  }
  const raw = fs.readFileSync(devcontainerPath, "utf-8");
  return parseJSONC(raw) as DevcontainerConfig;
}

function getTemplateDockerfilePath(ctx: vscode.ExtensionContext): string {
  return vscode.Uri.joinPath(ctx.extensionUri, "assets", "devcontainer", "Dockerfile").fsPath;
}

let outputChannel: vscode.OutputChannel | undefined;
function getOutput(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("Codium Devcontainer");
  }
  return outputChannel;
}

function logCommand(command: string, args: string[]) {
  const out = getOutput();
  const printable = [command, ...args].join(" ");
  out.appendLine("");
  out.appendLine(`$ ${printable}`);
}

function runCommand(
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string }
): Promise<void> {
  const out = getOutput();
  logCommand(command, args);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: options?.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    if (options?.input) {
      child.stdin.write(options.input);
      child.stdin.end();
    }
    child.stdout.on("data", (d) => out.append(d.toString()));
    child.stderr.on("data", (d) => out.append(d.toString()));
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function dockerBuildImage(
  ctx: vscode.ExtensionContext,
  wsFsPath: string,
  imageName: string,
  baseImage: string,
  remoteUser?: string
) {
  const templateDockerfile = getTemplateDockerfilePath(ctx);
  const args = [
    "build",
    "-t",
    imageName,
    "-f",
    templateDockerfile,
    "--build-arg",
    `BASE_IMAGE=${baseImage}`
  ];
  if (remoteUser) {
    args.push("--build-arg", `USERNAME=${remoteUser}`);
  }
  args.push(wsFsPath);
  vscode.window.showInformationMessage("Building SSH-enabled devcontainer image...");
  getOutput().show(true);
  await runCommand("docker", args);
}

async function dockerRestartContainer(imageName: string, wsFsPath: string) {
  try {
    await runCommand("docker", ["rm", "-f", `${imageName}-ctr`]);
  } catch {
    // ignore if container did not exist
  }

  vscode.window.showInformationMessage("Starting container with SSH...");
  getOutput().show(true);
  await runCommand("docker", [
    "run",
    "-d",
    "--name",
    `${imageName}-ctr`,
    "-p",
    "127.0.0.1:2222:22",
    "-v",
    `${wsFsPath}:/workspace`,
    imageName
  ]);
}

async function resolvePublicKeyPath(): Promise<string | undefined> {
  const homeDir = getHomeDir();
  const candidates = [
    path.join(homeDir, ".ssh", "id_ed25519.pub"),
    path.join(homeDir, ".ssh", "id_rsa.pub")
  ];
  let pubKeyPath = candidates.find((p) => fs.existsSync(p));
  if (!pubKeyPath) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: "Select public SSH key (*.pub)",
      filters: { Key: ["pub"] },
      defaultUri: homeDir ? vscode.Uri.file(path.join(homeDir, ".ssh")) : undefined
    });
    if (!picked || picked.length === 0) {
      vscode.window.showErrorMessage("No SSH public key selected. Cannot configure SSH access.");
      return undefined;
    }
    pubKeyPath = picked[0].fsPath;
  }
  return pubKeyPath;
}

async function ensureAuthorizedKeyInContainer(imageName: string, user: string, pubKeyPath: string) {
  await runCommand("docker", [
    "exec",
    `${imageName}-ctr`,
    "bash",
    "-lc",
    `mkdir -p /home/${user}/.ssh && chmod 700 /home/${user}/.ssh && touch /home/${user}/.ssh/authorized_keys && chmod 600 /home/${user}/.ssh/authorized_keys && chown -R ${user}:${user} /home/${user}/.ssh`
  ]);
  const keyData = fs.readFileSync(pubKeyPath, "utf-8").trim() + "\n";
  await runCommand(
    "docker",
    ["exec", "-i", `${imageName}-ctr`, "bash", "-lc", `cat >> /home/${user}/.ssh/authorized_keys`],
    { input: keyData }
  );
}

function ensureSshConfigHostAlias(hostAlias: string, port: number, user: string) {
  const homeDir = getHomeDir();
  const sshDir = path.join(homeDir, ".ssh");
  const sshConfigPath = path.join(sshDir, "config");
  fs.mkdirSync(sshDir, { recursive: true });
  let configText = fs.existsSync(sshConfigPath) ? fs.readFileSync(sshConfigPath, "utf-8") : "";
  const hostBlockHeader = new RegExp(`^Host\\s+${hostAlias}(\\s|$)`, "m");
  if (!hostBlockHeader.test(configText)) {
    const block = [
      `Host ${hostAlias}`,
      `  HostName 127.0.0.1`,
      `  Port ${port}`,
      `  User ${user}`,
      `  StrictHostKeyChecking no`,
      `  UserKnownHostsFile /dev/null`,
      ""
    ].join("\n");
    configText += (configText.endsWith("\n") ? "" : "\n") + block;
    fs.writeFileSync(sshConfigPath, configText, { mode: 0o600 });
  }
}

async function ensureSshRemoteExtensionAvailable() {
  const sshExtCandidates = ["ms-vscode-remote.remote-ssh", "jeanp413.open-remote-ssh"];
  const hasSshRemote = sshExtCandidates.some((id) => vscode.extensions.getExtension(id));
  if (hasSshRemote) return;

  const isPositron = (vscode.env.appName || "").toLowerCase().includes("posit");
  const suggestedId = isPositron ? "jeanp413.open-remote-ssh" : "ms-vscode-remote.remote-ssh";
  const choice = await vscode.window.showInformationMessage(
    `An SSH remote extension is required to open the workspace over SSH. Install ${suggestedId}?`,
    "Install",
    "Cancel"
  );
  if (choice === "Install") {
    await vscode.commands.executeCommand("workbench.extensions.installExtension", suggestedId);
  } else {
    throw new Error("SSH remote extension not installed");
  }
}

export function activate(context: vscode.ExtensionContext) {
  const buildAndRun = vscode.commands.registerCommand(
    "codiumDevcontainer.buildAndRun",
    async () => {
      try {
        const ws = getWorkspaceFolder();
        if (!ws) {
          vscode.window.showErrorMessage("No workspace open");
          return;
        }

        getOutput().show(true);
        // Ensure devcontainer.json exists and read it
        const devcontainer = readDevcontainerConfig(ws.uri.fsPath);
        await appendPostCreateToDockerfile(ws.uri.fsPath, devcontainer);
        const imageName = "codium-devcontainer";
        const baseImage: string = devcontainer.image || "node:22-bookworm";

        await dockerBuildImage(context, ws.uri.fsPath, imageName, baseImage);
        await dockerRestartContainer(imageName, ws.uri.fsPath);

        const pubKeyPath = await resolvePublicKeyPath();
        if (pubKeyPath) {
          await ensureAuthorizedKeyInContainer(imageName, "vscode", pubKeyPath);
        }

        const sshTerminal = vscode.window.createTerminal({
          name: "Devcontainer SSH",
          shellPath: "ssh",
          shellArgs: ["-p", "2222", "vscode@localhost"]
        });
        sshTerminal.show();
      } catch (err: any) {
        vscode.window.showErrorMessage(err.message);
      }
    }
  );

  const addDockerfileTemplate = vscode.commands.registerCommand(
    "codiumDevcontainer.addDockerfileTemplate",
    async () => {
      try {
        const ws = vscode.workspace.workspaceFolders?.[0];
        if (!ws) {
          vscode.window.showErrorMessage("No workspace open");
          return;
        }

        getOutput().show(true);
        const devcontainerDir = path.join(ws.uri.fsPath, ".devcontainer");
        const destDockerfile = path.join(devcontainerDir, "Dockerfile");

        fs.mkdirSync(devcontainerDir, { recursive: true });

        if (fs.existsSync(destDockerfile)) {
          const choice = await vscode.window.showWarningMessage(
            "A .devcontainer/Dockerfile already exists. Overwrite?",
            { modal: true },
            "Overwrite",
            "Cancel"
          );
          if (choice !== "Overwrite") {
            return;
          }
        }

        const templateUri = vscode.Uri.joinPath(
          context.extensionUri,
          "assets",
          "devcontainer",
          "Dockerfile"
        );

        const template = fs.readFileSync(templateUri.fsPath);
        fs.writeFileSync(destDockerfile, template);

        vscode.window.showInformationMessage(
          "Template Dockerfile added to .devcontainer/Dockerfile"
        );
        getOutput().appendLine("Template Dockerfile created.");

        const devcontainerJson = path.join(devcontainerDir, "devcontainer.json");
        if (!fs.existsSync(devcontainerJson)) {
          vscode.window.showInformationMessage(
            "No devcontainer.json found. The build command expects one in .devcontainer."
          );
        }
        // Attempt auto-append if devcontainer.json exists
        try {
          const devcontainer = readDevcontainerConfig(ws.uri.fsPath);
          await appendPostCreateToDockerfile(ws.uri.fsPath, devcontainer);
        } catch {}
      } catch (err: any) {
        vscode.window.showErrorMessage(err.message);
        getOutput().appendLine(`Error: ${err.message}`);
      }
    }
  );

  const openWorkspaceInDevcontainer = vscode.commands.registerCommand(
    "codiumDevcontainer.openWorkspaceInDevcontainer",
    async () => {
      try {
        const ws = getWorkspaceFolder();
        if (!ws) {
          vscode.window.showErrorMessage("No workspace open");
          return;
        }

        const devcontainer = readDevcontainerConfig(ws.uri.fsPath);
        await appendPostCreateToDockerfile(ws.uri.fsPath, devcontainer);
        const imageName = "codium-devcontainer";
        const baseImage: string = devcontainer.image || "node:22-bookworm";
        const remoteUser: string = devcontainer.remoteUser || "vscode";
        getOutput().show(true);
        await dockerBuildImage(context, ws.uri.fsPath, imageName, baseImage, remoteUser);
        await dockerRestartContainer(imageName, ws.uri.fsPath);

        const pubKeyPath = await resolvePublicKeyPath();
        if (pubKeyPath) {
          await ensureAuthorizedKeyInContainer(imageName, remoteUser, pubKeyPath);
        }

        // Ensure SSH config has a host alias
        const hostAlias = "codium-devcontainer";
        ensureSshConfigHostAlias(hostAlias, 2222, remoteUser);

        // Ensure an SSH remote extension is available (Microsoft or Positron's Open Remote - SSH)
        await ensureSshRemoteExtensionAvailable();

        // Open the workspace over Remote-SSH
        const remoteUri = vscode.Uri.parse(
          `vscode-remote://ssh-remote+${hostAlias}/workspace`
        );
        await vscode.commands.executeCommand("vscode.openFolder", remoteUri, true);
      } catch (err: any) {
        vscode.window.showErrorMessage(err.message);
        getOutput().appendLine(`Error: ${err.message}`);
      }
    }
  );
  async function appendPostCreateToDockerfile(wsPath: string, devcontainer: DevcontainerConfig) {
    const devcontainerDir = path.join(wsPath, ".devcontainer");
    const dockerfileRel = devcontainer.dockerFile || "Dockerfile";
    const dockerfilePath = path.isAbsolute(dockerfileRel)
      ? dockerfileRel
      : path.join(devcontainerDir, dockerfileRel);

    if (!fs.existsSync(dockerfilePath)) {
      return;
    }

    const post = devcontainer.postCreateCommand;
    if (!post || (Array.isArray(post) && post.length === 0)) {
      return;
    }

    const dockerfileText = fs.readFileSync(dockerfilePath, "utf-8");
    const marker = "# Added by codiumDevcontainer: postCreateCommand";
    if (dockerfileText.includes(marker)) {
      return;
    }

    const cmds: string[] = Array.isArray(post) ? post : [post];
    const lines: string[] = [marker, ...cmds.map((c) => `RUN ${c}`)];
    const newContent =
      (dockerfileText.endsWith("\n") ? dockerfileText : dockerfileText + "\n") +
      lines.join("\n") +
      "\n";

    fs.writeFileSync(dockerfilePath, newContent);
    getOutput().appendLine("Appended postCreateCommand to Dockerfile.");
  }

  context.subscriptions.push(buildAndRun, addDockerfileTemplate, openWorkspaceInDevcontainer);
}

export function deactivate() {}
