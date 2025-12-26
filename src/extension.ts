import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

export function activate(context: vscode.ExtensionContext) {
  const buildAndRun = vscode.commands.registerCommand(
    "codiumDevcontainer.buildAndRun",
    async () => {
      try {
        const ws = vscode.workspace.workspaceFolders?.[0];
        if (!ws) {
          vscode.window.showErrorMessage("No workspace open");
          return;
        }

        const devcontainerPath = path.join(
          ws.uri.fsPath,
          ".devcontainer",
          "devcontainer.json"
        );

        if (!fs.existsSync(devcontainerPath)) {
          vscode.window.showErrorMessage("No devcontainer.json found");
          return;
        }

        const devcontainer = JSON.parse(fs.readFileSync(devcontainerPath, "utf-8"));

        const imageName = "codium-devcontainer";

        // Determine base image from devcontainer.json (fallback to template default)
        const baseImage: string = devcontainer.image || "node:22-bookworm";

        // Always build using the SSH-enabled template Dockerfile
        const templateDockerfile = vscode.Uri.joinPath(
          context.extensionUri,
          "assets",
          "devcontainer",
          "Dockerfile"
        ).fsPath;

        vscode.window.showInformationMessage("Building SSH-enabled devcontainer image...");
        execSync(
          `docker build -t ${imageName} -f ${templateDockerfile} --build-arg BASE_IMAGE=${baseImage} ${ws.uri.fsPath}`,
          { stdio: "inherit" }
        );

        // If a previous container exists, remove it
        try {
          execSync(`docker rm -f ${imageName}-ctr`, { stdio: "ignore" });
        } catch {}

        // Start container with SSH port and workspace volume
        vscode.window.showInformationMessage("Starting container with SSH...");
        execSync(
          `docker run -d --name ${imageName}-ctr -p 127.0.0.1:2222:22 -v ${ws.uri.fsPath}:/workspace ${imageName}`,
          { stdio: "inherit" }
        );

        // Ensure authorized_keys is present
        const homeDir = process.env.HOME || process.env.USERPROFILE || "";
        const candidateKeys = [
          path.join(homeDir, ".ssh", "id_ed25519.pub"),
          path.join(homeDir, ".ssh", "id_rsa.pub")
        ];
        let pubKeyPath = candidateKeys.find((p) => fs.existsSync(p));
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
            vscode.window.showErrorMessage(
              "No SSH public key selected. Cannot configure SSH access."
            );
          } else {
            pubKeyPath = picked[0].fsPath;
          }
        }

        if (pubKeyPath) {
          execSync(
            `docker exec ${imageName}-ctr bash -lc "mkdir -p /home/vscode/.ssh && chmod 700 /home/vscode/.ssh && touch /home/vscode/.ssh/authorized_keys && chmod 600 /home/vscode/.ssh/authorized_keys && chown -R vscode:vscode /home/vscode/.ssh"`,
            { stdio: "inherit" }
          );
          const keyData = fs.readFileSync(pubKeyPath, "utf-8").trim() + "\n";
          execSync(
            `docker exec -i ${imageName}-ctr bash -lc 'cat >> /home/vscode/.ssh/authorized_keys'`,
            { input: keyData }
          );
        }

        // Open SSH terminal
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

        const devcontainerJson = path.join(devcontainerDir, "devcontainer.json");
        if (!fs.existsSync(devcontainerJson)) {
          vscode.window.showInformationMessage(
            "No devcontainer.json found. The build command expects one in .devcontainer."
          );
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(err.message);
      }
    }
  );

  const openWorkspaceInDevcontainer = vscode.commands.registerCommand(
    "codiumDevcontainer.openWorkspaceInDevcontainer",
    async () => {
      try {
        const ws = vscode.workspace.workspaceFolders?.[0];
        if (!ws) {
          vscode.window.showErrorMessage("No workspace open");
          return;
        }

        const devcontainerPath = path.join(
          ws.uri.fsPath,
          ".devcontainer",
          "devcontainer.json"
        );
        if (!fs.existsSync(devcontainerPath)) {
          vscode.window.showErrorMessage("No devcontainer.json found");
          return;
        }

        const devcontainer = JSON.parse(fs.readFileSync(devcontainerPath, "utf-8"));
        const imageName = "codium-devcontainer";
        const baseImage: string = devcontainer.image || "node:22-bookworm";
        const remoteUser: string = devcontainer.remoteUser || "vscode";

        const templateDockerfile = vscode.Uri.joinPath(
          context.extensionUri,
          "assets",
          "devcontainer",
          "Dockerfile"
        ).fsPath;

        vscode.window.showInformationMessage("Building SSH-enabled devcontainer image...");
        execSync(
          `docker build -t ${imageName} -f ${templateDockerfile} --build-arg BASE_IMAGE=${baseImage} --build-arg USERNAME=${remoteUser} ${ws.uri.fsPath}`,
          { stdio: "inherit" }
        );

        try {
          execSync(`docker rm -f ${imageName}-ctr`, { stdio: "ignore" });
        } catch {}

        vscode.window.showInformationMessage("Starting container with SSH...");
        execSync(
          `docker run -d --name ${imageName}-ctr -p 127.0.0.1:2222:22 -v ${ws.uri.fsPath}:/workspace ${imageName}`,
          { stdio: "inherit" }
        );

        // Configure SSH key for the specified user
        const homeDir = process.env.HOME || process.env.USERPROFILE || "";
        const candidateKeys = [
          path.join(homeDir, ".ssh", "id_ed25519.pub"),
          path.join(homeDir, ".ssh", "id_rsa.pub")
        ];
        let pubKeyPath = candidateKeys.find((p) => fs.existsSync(p));
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
            vscode.window.showErrorMessage(
              "No SSH public key selected. Cannot configure SSH access."
            );
          } else {
            pubKeyPath = picked[0].fsPath;
          }
        }

        if (pubKeyPath) {
          execSync(
            `docker exec ${imageName}-ctr bash -lc "mkdir -p /home/${remoteUser}/.ssh && chmod 700 /home/${remoteUser}/.ssh && touch /home/${remoteUser}/.ssh/authorized_keys && chmod 600 /home/${remoteUser}/.ssh/authorized_keys && chown -R ${remoteUser}:${remoteUser} /home/${remoteUser}/.ssh"`,
            { stdio: "inherit" }
          );
          const keyData = fs.readFileSync(pubKeyPath, "utf-8").trim() + "\n";
          execSync(
            `docker exec -i ${imageName}-ctr bash -lc 'cat >> /home/${remoteUser}/.ssh/authorized_keys'`,
            { input: keyData }
          );
        }

        // Ensure SSH config has a host alias
        const sshDir = path.join(homeDir, ".ssh");
        const sshConfigPath = path.join(sshDir, "config");
        fs.mkdirSync(sshDir, { recursive: true });
        let configText = fs.existsSync(sshConfigPath)
          ? fs.readFileSync(sshConfigPath, "utf-8")
          : "";
        const hostAlias = "codium-devcontainer";
        const hostBlockHeader = new RegExp(`^Host\\s+${hostAlias}(\\s|$)`, "m");
        if (!hostBlockHeader.test(configText)) {
          const block = [
            `Host ${hostAlias}`,
            `  HostName 127.0.0.1`,
            `  Port 2222`,
            `  User ${remoteUser}`,
            `  StrictHostKeyChecking no`,
            `  UserKnownHostsFile /dev/null`,
            ""
          ].join("\n");
          configText += (configText.endsWith("\n") ? "" : "\n") + block;
          fs.writeFileSync(sshConfigPath, configText, { mode: 0o600 });
        }

        // Ensure Remote-SSH extension is available
        const sshExtId = "ms-vscode-remote.remote-ssh";
        const sshExt = vscode.extensions.getExtension(sshExtId);
        if (!sshExt) {
          const choice = await vscode.window.showInformationMessage(
            "Remote - SSH extension is required to open the workspace over SSH. Install now?",
            "Install",
            "Cancel"
          );
          if (choice === "Install") {
            await vscode.commands.executeCommand(
              "workbench.extensions.installExtension",
              sshExtId
            );
          } else {
            return;
          }
        }

        // Open the workspace over Remote-SSH
        const remoteUri = vscode.Uri.parse(
          `vscode-remote://ssh-remote+${hostAlias}/workspace`
        );
        await vscode.commands.executeCommand("vscode.openFolder", remoteUri, true);
      } catch (err: any) {
        vscode.window.showErrorMessage(err.message);
      }
    }
  );

  context.subscriptions.push(buildAndRun, addDockerfileTemplate, openWorkspaceInDevcontainer);
}

export function deactivate() {}
