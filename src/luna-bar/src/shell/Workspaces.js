// Match the old compact bar, retaining existing higher workspaces and excluding scratchpads.
function ids(workspaces, active) {
    const result = [1, 2, 3, 4];
    for (const workspace of workspaces) {
        if (workspace.id > 4 && !result.includes(workspace.id))
            result.push(workspace.id);
    }
    if (active > 4 && !result.includes(active))
        result.push(active);
    return result.sort((a, b) => a - b);
}
