// Vite `?raw` imports (used by tests to load fixtures; workerd has no `fs`).
declare module "*.ics?raw" {
  const content: string;
  export default content;
}

// Repository templates read by `config/deployTemplate.test.ts`.
declare module "*.dev.vars.example?raw" {
  const content: string;
  export default content;
}
declare module "*/package.json?raw" {
  const content: string;
  export default content;
}
