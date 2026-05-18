const emitWarning = process.emitWarning.bind(process) as (...args: unknown[]) => void;

process.emitWarning = function filteredEmitWarning(
  warning: string | Error,
  typeOrOptions?: string | NodeJS.EmitWarningOptions,
  code?: string,
  ctor?: Function,
): void {
  const message = typeof warning === "string" ? warning : warning.message;
  const name = typeof warning === "string" ? typeOrOptions : warning.name;
  const warningCode = typeof typeOrOptions === "object" ? typeOrOptions.code : code;
  const isPunycodeDeprecation =
    name === "DeprecationWarning" &&
    (warningCode === "DEP0040" || message.includes("punycode"));

  if (isPunycodeDeprecation) return;

  if (typeof typeOrOptions === "object") {
    emitWarning(warning, typeOrOptions);
  } else {
    emitWarning(warning, typeOrOptions, code, ctor);
  }
} as typeof process.emitWarning;
