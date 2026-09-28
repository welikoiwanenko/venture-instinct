// Domain entry point. Must stay free of UI, persistence, network and Linear.

export const RUNTIME_NAME = "venture-instinct";

export function describeRuntime(): string {
  return `${RUNTIME_NAME} domain runtime (Node ${process.versions.node})`;
}

if (import.meta.main) {
  console.log(describeRuntime());
}
