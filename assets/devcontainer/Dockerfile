# Devcontainer base image for VS Code remote development
# Parametrized base image to align with devcontainer.json
ARG BASE_IMAGE=node:22-bookworm
FROM ${BASE_IMAGE}

# Install common tools
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       git \
       curl \
       sudo \
       bash \
       ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install SSH
RUN apt-get update && \
    apt-get install -y --no-install-recommends openssh-server sudo && \
    rm -rf /var/lib/apt/lists/*

# Set up SSH
RUN mkdir -p /var/run/sshd && \
    echo "PasswordAuthentication no" >> /etc/ssh/sshd_config && \
    echo "PermitRootLogin no" >> /etc/ssh/sshd_config && \
    echo "PubkeyAuthentication yes" >> /etc/ssh/sshd_config

# Create non-root user for dev
ARG USERNAME=vscode
ARG USER_UID=1000
ARG USER_GID=1000
RUN groupadd --gid $USER_GID $USERNAME \
    && useradd -m --uid $USER_UID --gid $USER_GID -s /bin/bash $USERNAME \
    && echo "$USERNAME ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Make sure there's a .ssh folder with the right permissions. The
# local id_rsa.pub gets mounted to here through Docker Compose
RUN mkdir -p /home/$USERNAME/.ssh && \
    chown $USERNAME:$USERNAME /home/$USERNAME/.ssh && \
    chmod 700 /home/$USERNAME/.ssh

EXPOSE 22

# Workdir where the workspace will be mounted
WORKDIR /workspace

# Start OpenSSH server in foreground for SSH access
CMD ["/usr/sbin/sshd", "-D"]
