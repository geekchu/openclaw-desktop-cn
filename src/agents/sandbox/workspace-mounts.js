import { SANDBOX_AGENT_WORKSPACE_MOUNT } from "./constants.js";
function mainWorkspaceMountSuffix(access) {
    return access === "rw" ? "" : ":ro";
}
function agentWorkspaceMountSuffix(access) {
    return access === "ro" ? ":ro" : "";
}
export function appendWorkspaceMountArgs(params) {
    const { args, workspaceDir, agentWorkspaceDir, workdir, workspaceAccess } = params;
    args.push("-v", `${workspaceDir}:${workdir}${mainWorkspaceMountSuffix(workspaceAccess)}`);
    if (workspaceAccess !== "none" && workspaceDir !== agentWorkspaceDir) {
        args.push("-v", `${agentWorkspaceDir}:${SANDBOX_AGENT_WORKSPACE_MOUNT}${agentWorkspaceMountSuffix(workspaceAccess)}`);
    }
}
