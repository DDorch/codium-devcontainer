import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import {
  getHomeDir,
  getHostAlias,
  getOutput,
  runCommand,
  runCommandCapture
} from "./devcontainerCore";

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
  const res1 = await runCommandCapture("docker", [
    "exec",
    containerName,
    "bash",
    "-lc",
    "awk -F: '$3>=1000 && $1!=\"nobody\" {print $1}' /etc/passwd | head -n1"
  ]);
  const candidate1 = res1.stdout.trim();
  if (candidate1) return candidate1;

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

export async function getEffectiveUser(containerName: string, remoteUser?: string): Promise<string> {
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

export async function setupSshAccess(containerName: string, user: string, port: number): Promise<boolean> {
  const pubKeyPath = await resolvePublicKeyPath();
  if (pubKeyPath) {
    await ensureAuthorizedKeyInContainer(containerName, user, pubKeyPath);
  }
  const ok = await verifySshLogin(user, port);
  return ok;
}

export function openSshTerminal(
  title: string,
  user: string,
  port: number,
  onClose?: () => void
): vscode.Terminal {
  const sshTerminal = vscode.window.createTerminal({
    name: title,
    shellPath: "ssh",
    shellArgs: [
      "-F",
      "/dev/null",
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-p",
      String(port),
      `${user}@localhost`
    ]
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

export async function openWorkspaceOverSsh(
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
