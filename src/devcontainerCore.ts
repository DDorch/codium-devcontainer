import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import JSON5 from "json5";
import * as net from "net";

export type DevcontainerConfig = {
  image?: string;
  remoteUser?: string;
  dockerFile?: string;
  postCreateCommand?: string | string[];
  postStartCommand?: string | string[];
};

export type ResolvedDevcontainerContext = {
  wsFsPath: string;
  devcontainer: DevcontainerConfig;
  imageName: string;
  containerName: string;
  baseImage: string;
  remoteUser: string | undefined;
};

export function getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0];
}

export function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || "";
}

export function getDevcontainerPath(wsFsPath: string): string {
  return path.join(wsFsPath, ".devcontainer", "devcontainer.json");
}

export function readDevcontainerConfig(wsFsPath: string): DevcontainerConfig {
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
export function getOutput(): vscode.OutputChannel {
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

export async function findFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.on("error", () => {
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
  let slug = name.replace(/[^a-z0-9._-]+/g, "-");
  slug = slug.replace(/^[._-]+|[._-]+$/g, "");
  return slug || "workspace";
}

export function getImageName(wsFsPath: string): string {
  const slug = makeWorkspaceSlug(wsFsPath);
  return `codium-devcontainer-${slug}`;
}

export function getContainerName(wsFsPath: string): string {
  const slug = makeWorkspaceSlug(wsFsPath);
  return `codium-devcontainer-${slug}`;
}

export function getHostAlias(wsFsPath: string): string {
  const slug = makeWorkspaceSlug(wsFsPath);
  return `codium-devcontainer-${slug}`;
}

export function resolveDevcontainerContext(wsFsPath: string): ResolvedDevcontainerContext {
  const devcontainer = readDevcontainerConfig(wsFsPath);
  return {
    wsFsPath,
    devcontainer,
    imageName: getImageName(wsFsPath),
    containerName: getContainerName(wsFsPath),
    baseImage: devcontainer.image || "node:22-bookworm",
    remoteUser: devcontainer.remoteUser
  };
}

export function runCommand(
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

export async function runCommandCapture(
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
  remoteUser?: string,
  dockerfilePath?: string
) {
  const dockerfileToUse = dockerfilePath || getTemplateDockerfilePath(ctx);
  const args = [
    "build",
    "-t",
    imageName,
    "-f",
    dockerfileToUse,
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
  } catch {}
  try {
    await runCommand("docker", ["rm", "-f", containerName]);
  } catch {}

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

async function createTemporaryDockerfile(
  ctx: vscode.ExtensionContext,
  wsFsPath: string,
  devcontainer: DevcontainerConfig | undefined
): Promise<string> {
  const templatePath = getTemplateDockerfilePath(ctx);
  const templateText = fs.readFileSync(templatePath, "utf-8");
  const post = devcontainer?.postCreateCommand;
  const marker = "# Added by codiumDevcontainer (temp): postCreateCommand";
  const cmds: string[] = !post ? [] : (Array.isArray(post) ? post : [post]);
  const lines: string[] = cmds.length ? [marker, ...cmds.map((c) => `RUN ${c}`)] : [];
  const newContent = templateText + (templateText.endsWith("\n") ? "" : "\n") + (lines.length ? lines.join("\n") + "\n" : "");
  const devcontainerDir = path.join(wsFsPath, ".devcontainer");
  fs.mkdirSync(devcontainerDir, { recursive: true });
  const tempPath = path.join(devcontainerDir, "Dockerfile.codium-temp");
  fs.writeFileSync(tempPath, newContent, "utf-8");
  getOutput().appendLine("Prepared temporary Dockerfile with postCreateCommand.");
  return tempPath;
}

async function buildImageWithEntrypoint(
  ctx: vscode.ExtensionContext,
  wsFsPath: string,
  imageName: string,
  baseImage: string,
  remoteUser?: string,
  devcontainer?: DevcontainerConfig
) {
  await stageEntrypointTemporarily(ctx, wsFsPath);
  const tempDockerfile = await createTemporaryDockerfile(ctx, wsFsPath, devcontainer);
  try {
    await dockerBuildImage(ctx, wsFsPath, imageName, baseImage, remoteUser, tempDockerfile);
  } finally {
    await cleanupEntrypointIfManaged(wsFsPath);
    if (tempDockerfile && fs.existsSync(tempDockerfile)) {
      try { fs.rmSync(tempDockerfile, { force: true }); } catch {}
    }
  }
}

export async function rebuildContainer(
  ctx: vscode.ExtensionContext,
  resolved: ResolvedDevcontainerContext,
  hostPort: number
) {
  await buildImageWithEntrypoint(
    ctx,
    resolved.wsFsPath,
    resolved.imageName,
    resolved.baseImage,
    resolved.remoteUser,
    resolved.devcontainer
  );
  await dockerRestartContainer(
    resolved.imageName,
    resolved.wsFsPath,
    hostPort,
    resolved.containerName
  );
}

export async function ensureContainerReadyAndGetPort(
  ctx: vscode.ExtensionContext,
  wsFsPath: string,
  resolved: ResolvedDevcontainerContext,
  forceRebuild: boolean
): Promise<{ port: number; containerName: string; imageName: string }> {
  const containerName = resolved.containerName;
  const imageName = resolved.imageName;
  const exists = await containerExists(containerName);
  let shouldRebuild = forceRebuild;
  let port: number | undefined;

  if (exists) {
    if (!forceRebuild) {
      const rebuildNeeded = await shouldRebuildForDevcontainer(wsFsPath, containerName);
      shouldRebuild = rebuildNeeded;
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
        shouldRebuild = choice === "Rebuild";
        getOutput().appendLine(`Decision: ${shouldRebuild ? "Rebuild" : "Reuse"} existing container.`);
      }
    }

    await ensureContainerStarted(containerName);
    port = await getMappedSshPort(containerName);
    if (!port && !shouldRebuild) {
      vscode.window.showWarningMessage(
        "Could not detect mapped SSH port for the running container. Rebuilding to allocate a new port."
      );
      shouldRebuild = true;
    }

    if (shouldRebuild || !port) {
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
          shouldRebuild = false;
          getOutput().appendLine("Decision: Reuse running container.");
          await ensureContainerStarted(containerName);
          port = await getMappedSshPort(containerName);
          if (!port) {
            vscode.window.showWarningMessage(
              "Could not detect mapped SSH port for the running container. Rebuilding to allocate a new port."
            );
            shouldRebuild = true;
          }
        }
      }
    }
  } else {
    shouldRebuild = true;
  }

  if (shouldRebuild || !port) {
    port = port ?? (await findFreePort());
    await rebuildContainer(ctx, resolved, port);
  }

  return { port: port!, containerName, imageName };
}
