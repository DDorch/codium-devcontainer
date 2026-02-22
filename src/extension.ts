import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import JSON5 from "json5";
import {
  DevcontainerConfig,
  ensureContainerReadyAndGetPort,
  findFreePort,
  getDevcontainerPath,
  getOutput,
  getWorkspaceFolder,
  rebuildContainer,
  resolveDevcontainerContext,
  runCommand
} from "./devcontainerCore";
import {
  getEffectiveUser,
  openSshTerminal,
  openWorkspaceOverSsh,
  setupSshAccess
} from "./sshRuntime";

export function activate(context: vscode.ExtensionContext) {
  // Reset postStart once-per-folder guard at the start of each remote window
  async function resetPostStartGuard() {
    try {
      if (!vscode.env.remoteName) return;
      const ws = getWorkspaceFolder();
      if (!ws) return;
      const key = `codiumDevcontainer.postStart.run:${ws.uri.fsPath}`;
      await context.workspaceState.update(key, undefined);
    } catch {}
  }
  async function updateDevcontainerContext() {
    const ws = getWorkspaceFolder();
    const has = ws ? fs.existsSync(getDevcontainerPath(ws.uri.fsPath)) : false;
    await vscode.commands.executeCommand("setContext", "codiumDevcontainer.hasConfig", has);
  }
  // Initialize context and watch for changes to devcontainer.json
  updateDevcontainerContext();
  // Ensure postStart can run once per remote session
  resetPostStartGuard();
  const ws = getWorkspaceFolder();
  if (ws) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(ws.uri.fsPath, ".devcontainer/devcontainer.json")
    );
    watcher.onDidCreate(async () => {
      await updateDevcontainerContext();
      await runPostStartCommandOnce(context);
    });
    watcher.onDidDelete(updateDevcontainerContext);
    watcher.onDidChange(async () => {
      await updateDevcontainerContext();
      await runPostStartCommandOnce(context);
    });
    context.subscriptions.push(watcher);
  }

  function getWorkspaceOrThrow(): vscode.WorkspaceFolder {
    const ws = getWorkspaceFolder();
    if (!ws) {
      throw new Error("No folder open");
    }
    return ws;
  }

  function getWorkspaceFsPathOrThrow(): string {
    return getWorkspaceOrThrow().uri.fsPath;
  }

  function withUiErrorHandling(
    action: () => Promise<void>,
    options?: { appendToOutput?: boolean }
  ): () => Promise<void> {
    return async () => {
      try {
        await action();
      } catch (err: any) {
        const message = err?.message ?? String(err);
        vscode.window.showErrorMessage(message);
        if (options?.appendToOutput ?? true) {
          getOutput().appendLine(`Error: ${message}`);
        }
      }
    };
  }

  async function openFolderOverSsh(forceRebuild: boolean): Promise<void> {
    const wsFsPath = getWorkspaceFsPathOrThrow();
    const resolved = resolveDevcontainerContext(wsFsPath);
    const { port, containerName } = await ensureContainerReadyAndGetPort(
      context,
      wsFsPath,
      resolved,
      forceRebuild
    );
    await openWorkspaceOverSsh(wsFsPath, containerName, resolved.remoteUser, port);
  }

  const buildAndRun = vscode.commands.registerCommand(
    "codiumDevcontainer.buildAndRun",
    withUiErrorHandling(async () => {
      getOutput().show(true);
      const wsFsPath = getWorkspaceFsPathOrThrow();
      const resolved = resolveDevcontainerContext(wsFsPath);
      const port = await findFreePort();
      await rebuildContainer(context, resolved, port);

      const detectedUser = await getEffectiveUser(resolved.containerName);
      await setupSshAccess(resolved.containerName, detectedUser, port);
      openSshTerminal("Devcontainer SSH", detectedUser, port, async () => {
        try {
          await runCommand("docker", ["rm", "-f", resolved.containerName]);
          getOutput().appendLine(`Stopped container ${resolved.containerName} after terminal closed.`);
        } catch (e: any) {
          getOutput().appendLine(`Failed to stop container ${resolved.containerName}: ${e?.message ?? e}`);
        }
      });
    }, { appendToOutput: false })
  );

  const addDockerfileTemplate = vscode.commands.registerCommand(
    "codiumDevcontainer.addDockerfileTemplate",
    withUiErrorHandling(async () => {
      const ws = getWorkspaceOrThrow();

      getOutput().show(true);
      const devcontainerDir = path.join(ws.uri.fsPath, ".devcontainer");
      const destDockerfile = path.join(devcontainerDir, "Dockerfile");

      fs.mkdirSync(devcontainerDir, { recursive: true });

      if (fs.existsSync(destDockerfile)) {
        const choice = await vscode.window.showWarningMessage(
          "A .devcontainer/Dockerfile already exists. Overwrite?",
          { modal: true },
          "Overwrite"
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
    })
  );

  const openFolderInDevcontainer = vscode.commands.registerCommand(
    "codiumDevcontainer.openFolderInDevcontainer",
    withUiErrorHandling(async () => {
      await openFolderOverSsh(false);
    })
  );

  const rebuildAndOpen = vscode.commands.registerCommand(
    "codiumDevcontainer.rebuildAndOpen",
    withUiErrorHandling(async () => {
      await openFolderOverSsh(true);
    })
  );

  const openDevcontainerConfig = vscode.commands.registerCommand(
    "codiumDevcontainer.openDevcontainerConfig",
    withUiErrorHandling(async () => {
      const ws = getWorkspaceOrThrow();
      const cfgPath = getDevcontainerPath(ws.uri.fsPath);
      if (!fs.existsSync(cfgPath)) {
        throw new Error(".devcontainer/devcontainer.json not found in this folder");
      }
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(cfgPath));
      await vscode.window.showTextDocument(doc, { preview: false });
    }, { appendToOutput: false })
  );

  const showMenu = vscode.commands.registerCommand(
    "codiumDevcontainer.showMenu",
    async () => {
      const ws = getWorkspaceFolder();
      const has = ws ? fs.existsSync(getDevcontainerPath(ws.uri.fsPath)) : false;
      const runIfHasConfig = async (commandId: string, missingMessage: string) => {
        if (!has) {
          vscode.window.showInformationMessage(missingMessage);
          return;
        }
        await vscode.commands.executeCommand(commandId);
      };
      const picks: vscode.QuickPickItem[] = [
        has
          ? { label: "$(gear) Open Devcontainer Configuration", detail: ".devcontainer/devcontainer.json" }
          : { label: "$(gear) Open Devcontainer Configuration", description: "(no devcontainer.json)" },
        has
          ? { label: "$(refresh) Open Folder in Devcontainer (SSH)", detail: "Build and open folder over SSH" }
          : { label: "$(circle-slash) Open Folder in Devcontainer (SSH)", description: "(requires .devcontainer/devcontainer.json)" }
        ,
        has
          ? { label: "$(sync) Rebuild & Open Folder in Devcontainer (SSH)", detail: "Force rebuild and recreate container" }
          : { label: "$(circle-slash) Rebuild & Open Folder in Devcontainer (SSH)", description: "(requires .devcontainer/devcontainer.json)" }
      ];
      const chosen = await vscode.window.showQuickPick(picks, {
        title: "Codium Devcontainer",
        placeHolder: "Select an action"
      });
      if (!chosen) return;
      if (chosen.label.includes("Open Devcontainer Configuration")) {
        await runIfHasConfig(
          "codiumDevcontainer.openDevcontainerConfig",
          "No devcontainer.json found in this folder. Use 'Devcontainer: Add Dockerfile Template' to scaffold and create .devcontainer/devcontainer.json."
        );
      } else if (chosen.label.includes("Open Folder in Devcontainer")) {
        await runIfHasConfig(
          "codiumDevcontainer.openFolderInDevcontainer",
          "Cannot reopen in devcontainer: .devcontainer/devcontainer.json is missing."
        );
      } else if (chosen.label.includes("Rebuild & Open")) {
        await runIfHasConfig(
          "codiumDevcontainer.rebuildAndOpen",
          "Cannot rebuild: .devcontainer/devcontainer.json is missing."
        );
      }
    }
  );

  context.subscriptions.push(
    buildAndRun,
    addDockerfileTemplate,
    openFolderInDevcontainer,
    openDevcontainerConfig,
    rebuildAndOpen,
    showMenu
  );
  // If running in a remote window (SSH), execute postStartCommand in a new terminal once.
  runPostStartCommandOnce(context);
}

async function runPostStartCommandOnce(context: vscode.ExtensionContext) {
  try {
    if (!vscode.env.remoteName) return;
    const ws = getWorkspaceFolder();
    if (!ws) return;
    const dev = await readDevcontainerConfigFromWorkspace(ws.uri);
    if (!dev) return;
    const postStart = dev.postStartCommand;
    if (!postStart || (Array.isArray(postStart) && postStart.length === 0)) return;
    const key = `codiumDevcontainer.postStart.run:${ws.uri.fsPath}`;
    const already = context.workspaceState.get<boolean>(key);
    if (already) return;
    const out = getOutput();
    out.appendLine("Running postStartCommand in remote terminal...");
    out.show(true);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Devcontainer: Running postStartCommand" },
      async () => {
        await vscode.commands.executeCommand("workbench.action.closePanel");
        const term = vscode.window.createTerminal({ name: "Devcontainer: Post Start" });
        term.show(false);
        const cmds: string[] = Array.isArray(postStart) ? postStart : [postStart];
        for (const c of cmds) {
          out.appendLine(`postStartCommand: ${c}`);
          term.sendText(c, true);
        }
      }
    );
    await context.workspaceState.update(key, true);
  } catch {
    // ignore
  }
}

async function waitForWorkspaceFile(uri: vscode.Uri, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      // not found yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function readDevcontainerConfigFromWorkspace(wsUri: vscode.Uri): Promise<DevcontainerConfig | undefined> {
  const uri = vscode.Uri.joinPath(wsUri, ".devcontainer", "devcontainer.json");
  const ok = await waitForWorkspaceFile(uri, 10000);
  if (!ok) return undefined;
  try {
    const data = await vscode.workspace.fs.readFile(uri);
    const raw = Buffer.from(data).toString("utf-8");
    return JSON5.parse(raw) as DevcontainerConfig;
  } catch {
    return undefined;
  }
}

export async function deactivate() {
  try {
    if (!vscode.env.remoteName) return;
    const ws = getWorkspaceFolder();
    if (!ws) return;
    const stopPath = path.join(ws.uri.fsPath, ".codium-devcontainer-stop");
    fs.writeFileSync(stopPath, "stop\n");
  } catch {
    // ignore
  }
}
