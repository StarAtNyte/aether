/** A runner that imports the measuring code the first time the assistant asks. */
export const lazyLevelTools = async (world, name, input) => {
    const { runLevelTool } = await import('@aether/playtest/level');
    const r = await runLevelTool(world, name, input);
    return { ok: r.ok, text: r.text, patches: r.patches, message: r.message, ...(r.data ? { data: r.data } : {}) };
};
