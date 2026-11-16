// Stub of ST's scripts/extensions.js for the pin-flow harness.
export const extension_settings = {};

let lastTemplateData = null;
export async function renderExtensionTemplateAsync(folder, id, data) {
    lastTemplateData = structuredClone(data);
    return '<div>template</div>';
}
export function __lastTemplateData() {
    return lastTemplateData;
}
export function loadExtensionSettings() {}
