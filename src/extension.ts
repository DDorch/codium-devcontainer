import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { execSync, spawn } from "child_process";
import JSON5 from "json5";
import * as net from "net";

type DevcontainerConfig = {
  image?: string;
  remoteUser?: string;
  dockerFile?: string;
  postCreateCommand?: string | string[];
  postStartCommand?: string | string[];
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
  return JSON5.parse(raw) as DevcontainerConfig;
}

function getTemplateDockerfilePath(ctx: vscode.ExtensionContext): string {
  return vscode.Uri.joinPath(ctx.extensionUri, "assets", "devcontainer", "Dockerfile").fsPath;
}

function getTemplateEntrypointPath(ctx: vscode.ExtensionContext): string {
  return vscode.Uri.joinPath(ctx.extensionUri, "assets", "devcontainer", "entrypoint.sh").fsPath;
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

async function findFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.on("error", () => {
      // Fallback to a common port if something odd happens
      resolve(2222);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 2222;
      server.close(() => resolve(port));
    });
  });
}

function makeWorkspaceSlug(wsFsPath: string): string {
  const name = path.basename(wsFsPath).toLowerCase();
  // Minimal sanitization for Docker tag compliance
  let slug = name.replace(/[^a-z0-9._-]+/g, "-");
  slug = slug.replace(/^[._-]+|[._-]+$/g, "");
  return slug || "workspace";
}

function getImageName(wsFsPath: string): string {
  const slug = makeWorkspaceSlug(wsFsPath);
  return `codium-devcontainer-${slug}`;
}

function getContainerName(wsFsPath: string): string {
  const slug = makeWorkspaceSlug(wsFsPath);
  return `codium-devcontainer-${slug}`;
}

function getHostAlias(wsFsPath: string): string {
  const slug = makeWorkspaceSlug(wsFsPath);
  return `codium-devcontainer-${slug}`;
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

async function runCommandCapture(
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv }
): Promise<{ stdout: string; stderr: string; code: number }> {
  const out = getOutput();
  logCommand(command, args);
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: options?.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      out.append(s);
    });
    child.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      out.append(s);
    });
    child.on("error", () => resolve({ stdout: "", stderr: "error", code: 1 }));
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
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

async function dockerRestartContainer(
  imageName: string,
  wsFsPath: string,
  hostPort: number,
  containerName: string
) {
  try {
    await runCommand("docker", ["stop", containerName]);
  } catch {
    // ignore if not running
  }
  try {
    await runCommand("docker", ["rm", "-f", containerName]);
  } catch {
    // ignore if container did not exist
  }

  vscode.window.showInformationMessage(`Starting container with SSH on localhost:${hostPort}...`);
  getOutput().show(true);
  const projectName = path.basename(wsFsPath);
  await runCommand("docker", [
    "run",
    "-d",
    "--name",
    containerName,
    "-e",
    `CODIUM_WS=/workspace/${projectName}`,
    "-p",
    `127.0.0.1:${hostPort}:22`,
    "-v",
    `${wsFsPath}:/workspace/${projectName}`,
    "-w",
    `/workspace/${projectName}`,
    imageName
  ]);
}

async function containerExists(name: string): Promise<boolean> {
  const res = await runCommandCapture("docker", ["inspect", name]);
  return res.code === 0;
}

async function getMappedSshPort(name: string): Promise<number | undefined> {
  const res = await runCommandCapture("docker", [
    "inspect",
    "-f",
    "{{ (index (index .NetworkSettings.Ports \"22/tcp\") 0).HostPort }}",
    name
  ]);
  if (res.code !== 0) return undefined;
  const portStr = res.stdout.trim();
  const port = Number(portStr);
  return Number.isFinite(port) ? port : undefined;
}

async function ensureContainerStarted(name: string): Promise<void> {
  await runCommand("docker", ["start", name]).catch(async () => {
    await runCommand("docker", ["restart", name]).catch(() => {});
  });
}

async function isContainerRunning(name: string): Promise<boolean> {
  const res = await runCommandCapture("docker", [
    "inspect",
    "-f",
    "{{.State.Running}}",
    name
  ]);
  return res.code === 0 && res.stdout.trim() === "true";
}

async function stopAndRemoveContainer(name: string): Promise<boolean> {
  try {
    await runCommand("docker", ["stop", name]).catch(() => {});
    await runCommand("docker", ["rm", "-f", name]);
    return true;
  } catch (e) {
    vscode.window.showErrorMessage(
      `Failed to remove container '${name}'. You may need additional privileges or to stop it manually.`
    );
    return false;
  }
}

function getDevcontainerMtimeMs(wsFsPath: string): number | undefined {
  try {
    const st = fs.statSync(getDevcontainerPath(wsFsPath));
    return st.mtimeMs;
  } catch {
    return undefined;
  }
}

async function getContainerCreatedMs(name: string): Promise<number | undefined> {
  const res = await runCommandCapture("docker", [
    "inspect",
    "-f",
    "{{.Created}}",
    name
  ]);
  if (res.code !== 0) return undefined;
  const iso = res.stdout.trim();
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
}

async function shouldRebuildForDevcontainer(wsFsPath: string, name: string): Promise<boolean> {
  const dcMtime = getDevcontainerMtimeMs(wsFsPath);
  const createdMs = await getContainerCreatedMs(name);
  return dcMtime !== undefined && createdMs !== undefined && dcMtime > createdMs;
}

async function getContainerUsername(containerName: string): Promise<string> {
  const result = await runCommandCapture("docker", ["exec", containerName, "whoami"]);
  if (result.code === 0 && result.stdout.trim()) {
    return result.stdout.trim();
  }
  vscode.window.showWarningMessage(
    "Could not detect container user with 'whoami'. Falling back to 'root'."
  );
  return "root";
}

async function detectPreferredNonRootUser(containerName: string): Promise<string | undefined> {
  // Try to find a typical login user (uid >= 1000) from /etc/passwd
  const res1 = await runCommandCapture("docker", [
    "exec",
    containerName,
    "bash",
    "-lc",
    "awk -F: '$3>=1000 && $1!=\"nobody\" {print $1}' /etc/passwd | head -n1"
  ]);
  const candidate1 = res1.stdout.trim();
  if (candidate1) return candidate1;

  // Fallback: pick the first directory name under /home
  const res2 = await runCommandCapture("docker", [
    "exec",
    containerName,
    "bash",
    "-lc",
    "ls -1 /home 2>/dev/null | head -n1"
  ]);
  const candidate2 = res2.stdout.trim();
  if (candidate2) return candidate2;
  return undefined;
}

async function getUserHome(containerName: string, user: string): Promise<string> {
  const res = await runCommandCapture("docker", [
    "exec",
    containerName,
    "bash",
    "-lc",
    `eval echo ~${user}`
  ]);
  const home = res.stdout.trim();
  if (home) return home;
  return user === "root" ? "/root" : `/home/${user}`;
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

async function ensureAuthorizedKeyInContainer(containerName: string, user: string, pubKeyPath: string) {
  const home = await getUserHome(containerName, user);
  await runCommand("docker", [
    "exec",
    containerName,
    "bash",
    "-lc",
    `mkdir -p ${home}/.ssh && chmod 700 ${home}/.ssh && touch ${home}/.ssh/authorized_keys && chmod 600 ${home}/.ssh/authorized_keys && chown -R ${user}:${user} ${home}/.ssh`
  ]);
  const keyData = fs.readFileSync(pubKeyPath, "utf-8").trim() + "\n";
  await runCommand(
    "docker",
    ["exec", "-i", containerName, "bash", "-lc", `cat >> ${home}/.ssh/authorized_keys`],
    { input: keyData }
  );
}

async function verifySshLogin(user: string, port: number): Promise<boolean> {
  const res = await runCommandCapture("ssh", [
    "-F",
    "/dev/null",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-p",
    String(port),
    `${user}@localhost`,
    "true"
  ]);
  if (res.code === 0) return true;
  if (res.stderr.includes("Bad configuration option")) {
    vscode.window.showWarningMessage(
      "SSH config parsing failed due to an invalid option in ~/.ssh/config. Comment out or remove non-standard options, then retry."
    );
  } else {
    vscode.window.showWarningMessage(
      `SSH login failed for user '${user}'. If the container uses 'root' and root login is disabled, set 'remoteUser' in devcontainer.json to a non-root user or adjust sshd_config.`
    );
  }
  return false;
}

async function getEffectiveUser(containerName: string, remoteUser?: string): Promise<string> {
  if (remoteUser) {
    return remoteUser;
  }
  let user = await getContainerUsername(containerName);
  if (user === "root") {
    const alt = await detectPreferredNonRootUser(containerName);
    if (alt) {
      user = alt;
      vscode.window.showInformationMessage(
        `Detected default user 'root'; using '${alt}' for SSH. Provide 'remoteUser' to force a specific user.`
      );
    }
  }
  return user;
}

async function setupSshAccess(containerName: string, user: string, port: number): Promise<boolean> {
  const pubKeyPath = await resolvePublicKeyPath();
  if (pubKeyPath) {
    await ensureAuthorizedKeyInContainer(containerName, user, pubKeyPath);
  }
  const ok = await verifySshLogin(user, port);
  return ok;
}


async function openWorkspaceOverSsh(
  wsFsPath: string,
  containerName: string,
  remoteUser: string | undefined,
  port: number
): Promise<void> {
  const effectiveUser = await getEffectiveUser(containerName, remoteUser);
  const ok = await setupSshAccess(containerName, effectiveUser, port);
  const projectName = path.basename(wsFsPath);
  const hostAlias = getHostAlias(wsFsPath);
  ensureSshConfigHostAlias(hostAlias, port, effectiveUser);
  await ensureSshRemoteExtensionAvailable();
  if (!ok) {
    openSshTerminal("Devcontainer SSH (manual)", effectiveUser, port, async () => {
      try {
        await runCommand("docker", ["rm", "-f", containerName]);
        getOutput().appendLine(`Stopped container ${containerName} after terminal closed.`);
      } catch (e: any) {
        getOutput().appendLine(`Failed to stop container ${containerName}: ${e?.message ?? e}`);
      }
    });
    return;
  }
  const remoteUri = vscode.Uri.parse(
    `vscode-remote://ssh-remote+${hostAlias}/workspace/${projectName}`
  );
  await vscode.commands.executeCommand("vscode.openFolder", remoteUri, true);
}

function openSshTerminal(
  title: string,
  user: string,
  port: number,
  onClose?: () => void
): vscode.Terminal {
  const sshTerminal = vscode.window.createTerminal({
    name: title,
    shellPath: "ssh",
    shellArgs: ["-F", "/dev/null", "-p", String(port), `${user}@localhost`]
  });
  sshTerminal.show();
  if (onClose) {
    const sub = vscode.window.onDidCloseTerminal((t) => {
      if (t === sshTerminal) {
        try {
          onClose();
        } finally {
          sub.dispose();
        }
      }
    });
  }
  return sshTerminal;
}

function ensureSshConfigHostAlias(hostAlias: string, port: number, user: string) {
  const homeDir = getHomeDir();
  const sshDir = path.join(homeDir, ".ssh");
  const sshConfigPath = path.join(sshDir, "config");
  fs.mkdirSync(sshDir, { recursive: true });
  let configText = fs.existsSync(sshConfigPath) ? fs.readFileSync(sshConfigPath, "utf-8") : "";
  const block = [
    `Host ${hostAlias}`,
    `  HostName 127.0.0.1`,
    `  Port ${port}`,
    `  User ${user}`,
    `  StrictHostKeyChecking no`,
    `  UserKnownHostsFile /dev/null`,
    ""
  ].join("\n");

  const blockRegex = new RegExp(`^Host\\s+${hostAlias}[\\s\\S]*?(?=^Host\\s+|\\Z)`, "m");
  if (blockRegex.test(configText)) {
    configText = configText.replace(blockRegex, block);
  } else {
    configText += (configText.endsWith("\n") ? "" : "\n") + block;
  }
  fs.writeFileSync(sshConfigPath, configText, { mode: 0o600 });
}

async function ensureSshRemoteExtensionAvailable() {
  const sshExtCandidates = ["ms-vscode-remote.remote-ssh", "jeanp413.open-remote-ssh"];
  const hasSshRemote = sshExtCandidates.some((id) => vscode.extensions.getExtension(id));
  if (hasSshRemote) return;

  const isPositron = (vscode.env.appName || "").toLowerCase().includes("posit");
  const suggestedId = isPositron ? "jeanp413.open-remote-ssh" : "ms-vscode-remote.remote-ssh";
  const choice = await vscode.window.showInformationMessage(
    `An SSH remote extension is required to open the folder over SSH. Install ${suggestedId}?`,
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

  const buildAndRun = vscode.commands.registerCommand(
    "codiumDevcontainer.buildAndRun",
    async () => {
      try {
        const ws = getWorkspaceFolder();
        if (!ws) {
          vscode.window.showErrorMessage("No folder open");
          return;
        }

        getOutput().show(true);
        // Ensure devcontainer.json exists and read it
        const devcontainer = readDevcontainerConfig(ws.uri.fsPath);
        await appendPostCreateToDockerfile(ws.uri.fsPath, devcontainer);
        const imageName = getImageName(ws.uri.fsPath);
        const baseImage: string = devcontainer.image || "node:22-bookworm";
        const remoteUser: string | undefined = devcontainer.remoteUser;
        const port = await findFreePort();
        const containerName = getContainerName(ws.uri.fsPath);

        await buildImageWithEntrypoint(context, ws.uri.fsPath, imageName, baseImage, remoteUser);
        await dockerRestartContainer(imageName, ws.uri.fsPath, port, containerName);

        const detectedUser = await getEffectiveUser(containerName);
        await setupSshAccess(containerName, detectedUser, port);
        openSshTerminal("Devcontainer SSH", detectedUser, port, async () => {
          try {
            await runCommand("docker", ["rm", "-f", containerName]);
            getOutput().appendLine(`Stopped container ${containerName} after terminal closed.`);
          } catch (e: any) {
            getOutput().appendLine(`Failed to stop container ${containerName}: ${e?.message ?? e}`);
          }
        });
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
          vscode.window.showErrorMessage("No folder open");
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

        // Entrypoint script will be staged automatically during builds to avoid workspace pollution.

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

  const openFolderInDevcontainer = vscode.commands.registerCommand(
    "codiumDevcontainer.openFolderInDevcontainer",
    async () => {
      try {
        const ws = getWorkspaceFolder();
        if (!ws) {
          vscode.window.showErrorMessage("No folder open");
          return;
        }
        const devcontainer = readDevcontainerConfig(ws.uri.fsPath);
        const baseImage: string = devcontainer.image || "node:22-bookworm";
        const remoteUser: string | undefined = devcontainer.remoteUser;
        const { port, containerName } = await ensureContainerReadyAndGetPort(
          context,
          ws.uri.fsPath,
          baseImage,
          remoteUser,
          false
        );
        await openWorkspaceOverSsh(ws.uri.fsPath, containerName, remoteUser, port);
      } catch (err: any) {
        vscode.window.showErrorMessage(err.message);
        getOutput().appendLine(`Error: ${err.message}`);
      }
    }
  );

  const rebuildAndOpen = vscode.commands.registerCommand(
    "codiumDevcontainer.rebuildAndOpen",
    async () => {
      try {
        const ws = getWorkspaceFolder();
        if (!ws) {
          vscode.window.showErrorMessage("No folder open");
          return;
        }
        const containerName = getContainerName(ws.uri.fsPath);
        const imageName = getImageName(ws.uri.fsPath);
        const devcontainer = readDevcontainerConfig(ws.uri.fsPath);
        const baseImage: string = devcontainer.image || "node:22-bookworm";
        const remoteUser: string | undefined = devcontainer.remoteUser;

        const exists = await containerExists(containerName);
        const existingPort = exists ? await getMappedSshPort(containerName) : undefined;
        let hostPort: number | undefined = existingPort;

        if (exists) {
          const running = await isContainerRunning(containerName);
          if (running) {
            const choice = await vscode.window.showWarningMessage(
              "Container is currently running. How would you like to proceed?",
              { modal: true },
              "Kill & Rebuild",
              "Reuse"
            );
            if (!choice) {
              return;
            }
            if (choice === "Reuse") {
              await ensureContainerStarted(containerName);
              hostPort = hostPort ?? (await getMappedSshPort(containerName));
              if (!hostPort) {
                vscode.window.showWarningMessage(
                  "Could not detect mapped SSH port for the running container. Rebuilding to allocate a new port."
                );
              } else {
                const effectiveUser = await getEffectiveUser(containerName, remoteUser);
                await openWorkspaceOverSsh(ws.uri.fsPath, containerName, remoteUser, hostPort);
                return;
              }
            }
          }
        }

        hostPort = hostPort ?? (await findFreePort());
        await buildImageWithEntrypoint(context, ws.uri.fsPath, imageName, baseImage, remoteUser);
        await dockerRestartContainer(imageName, ws.uri.fsPath, hostPort, containerName);

        await openWorkspaceOverSsh(ws.uri.fsPath, containerName, remoteUser, hostPort);
      } catch (err: any) {
        vscode.window.showErrorMessage(err.message);
        getOutput().appendLine(`Error: ${err.message}`);
      }
    }
  );

  const openDevcontainerConfig = vscode.commands.registerCommand(
    "codiumDevcontainer.openDevcontainerConfig",
    async () => {
      const ws = getWorkspaceFolder();
      if (!ws) {
        vscode.window.showErrorMessage("No folder open");
        return;
      }
      const cfgPath = getDevcontainerPath(ws.uri.fsPath);
      if (!fs.existsSync(cfgPath)) {
        vscode.window.showErrorMessage(".devcontainer/devcontainer.json not found in this folder");
        return;
      }
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(cfgPath));
      await vscode.window.showTextDocument(doc, { preview: false });
    }
  );

  const showMenu = vscode.commands.registerCommand(
    "codiumDevcontainer.showMenu",
    async () => {
      const ws = getWorkspaceFolder();
      const has = ws ? fs.existsSync(getDevcontainerPath(ws.uri.fsPath)) : false;
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
        if (!has) {
          vscode.window.showInformationMessage(
            "No devcontainer.json found in this folder. Use 'Devcontainer: Add Dockerfile Template' to scaffold and create .devcontainer/devcontainer.json."
          );
          return;
        }
        await vscode.commands.executeCommand("codiumDevcontainer.openDevcontainerConfig");
      } else if (chosen.label.includes("Open Folder in Devcontainer")) {
        if (!has) {
          vscode.window.showInformationMessage(
            "Cannot reopen in devcontainer: .devcontainer/devcontainer.json is missing."
          );
          return;
        }
        await vscode.commands.executeCommand("codiumDevcontainer.openFolderInDevcontainer");
      } else if (chosen.label.includes("Rebuild & Open")) {
        if (!has) {
          vscode.window.showInformationMessage(
            "Cannot rebuild: .devcontainer/devcontainer.json is missing."
          );
          return;
        }
        await vscode.commands.executeCommand("codiumDevcontainer.rebuildAndOpen");
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

  async function ensureWorkspaceEntrypoint(ctx: vscode.ExtensionContext, wsPath: string) {
    try {
      const devcontainerDir = path.join(wsPath, ".devcontainer");
      const destEntrypoint = path.join(devcontainerDir, "entrypoint.sh");
      fs.mkdirSync(devcontainerDir, { recursive: true });
      const marker = "# Added by codiumDevcontainer: entrypoint";
      const needsWrite = !fs.existsSync(destEntrypoint) ||
        !fs.readFileSync(destEntrypoint, "utf-8").includes(marker);
      if (needsWrite) {
        const templateEntrypoint = getTemplateEntrypointPath(ctx);
        const content = fs.readFileSync(templateEntrypoint);
        fs.writeFileSync(destEntrypoint, content, { mode: 0o755 });
        getOutput().appendLine("Workspace entrypoint.sh created in .devcontainer.");
      }
    } catch (e: any) {
      getOutput().appendLine(`Failed to ensure entrypoint.sh: ${e?.message ?? e}`);
    }
  }

  async function stageEntrypointTemporarily(ctx: vscode.ExtensionContext, wsPath: string) {
    try {
      const devcontainerDir = path.join(wsPath, ".devcontainer");
      const destEntrypoint = path.join(devcontainerDir, "entrypoint.sh");
      fs.mkdirSync(devcontainerDir, { recursive: true });
      const marker = "# Added by codiumDevcontainer: entrypoint";
      const hasMarker = fs.existsSync(destEntrypoint) &&
        fs.readFileSync(destEntrypoint, "utf-8").includes(marker);
      if (!hasMarker) {
        const templateEntrypoint = getTemplateEntrypointPath(ctx);
        const content = fs.readFileSync(templateEntrypoint);
        fs.writeFileSync(destEntrypoint, content, { mode: 0o755 });
        getOutput().appendLine("Staged entrypoint.sh in .devcontainer for build.");
      }
    } catch (e: any) {
      getOutput().appendLine(`Failed to stage entrypoint.sh: ${e?.message ?? e}`);
    }
  }

  async function cleanupEntrypointIfManaged(wsPath: string) {
    try {
      const devcontainerDir = path.join(wsPath, ".devcontainer");
      const destEntrypoint = path.join(devcontainerDir, "entrypoint.sh");
      if (!fs.existsSync(destEntrypoint)) return;
      const text = fs.readFileSync(destEntrypoint, "utf-8");
      const marker = "# Added by codiumDevcontainer: entrypoint";
      if (text.includes(marker)) {
        fs.rmSync(destEntrypoint, { force: true });
        getOutput().appendLine("Cleaned up staged entrypoint.sh from workspace.");
      }
    } catch (e: any) {
      getOutput().appendLine(`Failed to cleanup entrypoint.sh: ${e?.message ?? e}`);
    }
  }

  async function buildImageWithEntrypoint(
    ctx: vscode.ExtensionContext,
    wsFsPath: string,
    imageName: string,
    baseImage: string,
    remoteUser?: string
  ) {
    await stageEntrypointTemporarily(ctx, wsFsPath);
    try {
      await dockerBuildImage(ctx, wsFsPath, imageName, baseImage, remoteUser);
    } finally {
      await cleanupEntrypointIfManaged(wsFsPath);
    }
  }

  async function ensureContainerReadyAndGetPort(
    ctx: vscode.ExtensionContext,
    wsFsPath: string,
    baseImage: string,
    remoteUser: string | undefined,
    forceRebuild: boolean
  ): Promise<{ port: number; containerName: string; imageName: string }> {
    const containerName = getContainerName(wsFsPath);
    const imageName = getImageName(wsFsPath);
    const exists = await containerExists(containerName);
    let port: number | undefined;

    if (exists) {
      let userWantsRebuild = forceRebuild;
      if (!forceRebuild) {
        const rebuildNeeded = await shouldRebuildForDevcontainer(wsFsPath, containerName);
        userWantsRebuild = rebuildNeeded;
        if (rebuildNeeded) {
          const choice = await vscode.window.showWarningMessage(
            "Devcontainer configuration changed since container creation. How would you like to proceed?",
            { modal: true },
            "Rebuild",
            "Reuse"
          );
          if (!choice) {
            throw new Error("Operation cancelled");
          }
          userWantsRebuild = choice === "Rebuild";
          getOutput().appendLine(`Decision: ${userWantsRebuild ? "Rebuild" : "Reuse"} existing container.`);
        }
      }

      await ensureContainerStarted(containerName);
      port = await getMappedSshPort(containerName);
      if (!port && !userWantsRebuild) {
        vscode.window.showWarningMessage(
          "Could not detect mapped SSH port for the running container. Rebuilding to allocate a new port."
        );
        userWantsRebuild = true;
      }

      if (userWantsRebuild || !port || forceRebuild) {
        const running = await isContainerRunning(containerName);
        if (running) {
          const choice2 = await vscode.window.showWarningMessage(
            "Container is currently running. How would you like to proceed?",
            { modal: true },
            "Kill & Rebuild",
            "Reuse"
          );
          if (!choice2) {
            throw new Error("Operation cancelled");
          }
          if (choice2 === "Reuse") {
            userWantsRebuild = false;
            getOutput().appendLine("Decision: Reuse running container.");
          }
        }

        if (userWantsRebuild || !port || forceRebuild) {
          port = port || (await findFreePort());
          await buildImageWithEntrypoint(ctx, wsFsPath, imageName, baseImage, remoteUser);
          await dockerRestartContainer(imageName, wsFsPath, port, containerName);
        }
      }
    } else {
      port = await findFreePort();
      await buildImageWithEntrypoint(ctx, wsFsPath, imageName, baseImage, remoteUser);
      await dockerRestartContainer(imageName, wsFsPath, port, containerName);
    }

    return { port: port!, containerName, imageName };
  }

  // Already added above
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
