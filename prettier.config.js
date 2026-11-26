/** @type {import('prettier').Config & import('prettier-plugin-tailwindcss').PluginOptions} */
export default {
  plugins: ["prettier-plugin-tailwindcss"],
  overrides: [{ files: "*.jsonc", options: { trailingComma: "none" } }],
};
