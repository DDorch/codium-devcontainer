# Devcontainer base image for VS Code remote development
# Parametrized base image to align with devcontainer.json
ARG BASE_IMAGE=node:22-bookworm
FROM ${BASE_IMAGE}

# Install common tools
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       git \
       curl \
     iproute2 \
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

# Optionally create a non-root dev user when USERNAME is provided via build-arg
ARG USERNAME
ARG USER_UID=1000
ARG USER_GID=1000

# Create group and user safely only if USERNAME is set; otherwise, keep base image's default user
RUN set -e; \
    if [ -n "$USERNAME" ]; then \
      if ! getent group "$USERNAME" >/dev/null; then \
        if getent group "$USER_GID" >/dev/null; then \
          groupadd "$USERNAME"; \
        else \
          groupadd --gid "$USER_GID" "$USERNAME"; \
        fi; \
      fi; \
      if id -u "$USERNAME" >/dev/null 2>&1; then \
        usermod -g "$USERNAME" -s /bin/bash "$USERNAME"; \
      else \
        if getent passwd "$USER_UID" >/dev/null; then \
          useradd -m -g "$USERNAME" -s /bin/bash "$USERNAME"; \
        else \
          useradd -m --uid "$USER_UID" -g "$USERNAME" -s /bin/bash "$USERNAME"; \
        fi; \
      fi; \
      echo "$USERNAME ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers; \
      mkdir -p /home/$USERNAME/.ssh && chown $USERNAME:$USERNAME /home/$USERNAME/.ssh && chmod 700 /home/$USERNAME/.ssh; \
    fi

EXPOSE 22

# Workdir where the workspace will be mounted
WORKDIR /workspace

# Copy entrypoint from workspace to image and configure as default command
COPY .devcontainer/entrypoint.sh /usr/local/bin/codium-devcontainer-entrypoint
RUN chmod +x /usr/local/bin/codium-devcontainer-entrypoint

# Start entrypoint which manages sshd and shutdown
CMD ["/usr/local/bin/codium-devcontainer-entrypoint"]
