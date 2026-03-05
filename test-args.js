const argv = process.argv;
console.log("Original process.argv:", argv);

const isExecPath = (value) => {
  if (!value) return false;
  const lower = value.toLowerCase();
  return lower.includes("node.exe") || value === "node";
};

// V1 (Original)
const next1 = [...argv];
for (let i = 1; i <= 3 && i < next1.length; ) {
  if (isExecPath(next1[i])) {
    next1.splice(i, 1);
    continue;
  }
  i += 1;
}
const filtered1 = next1.filter((arg, index) => index === 0 || !isExecPath(arg));
const cleaned1 = [...filtered1];
for (let i = 2; i < cleaned1.length; ) {
  const arg = cleaned1[i];
  if (!arg || arg.startsWith("-")) {
    i += 1;
    continue;
  }
  if (isExecPath(arg)) {
    cleaned1.splice(i, 1);
    continue;
  }
  break;
}
console.log("Original parsed:", cleaned1);

// V2 (My Fixed version)
const next2 = [...argv];
for (let i = 1; i <= 3 && i < next2.length; ) {
  if (isExecPath(next2[i])) {
    next2[i] = "node";
    i += 1;
    continue;
  }
  i += 1;
}
const filtered2 = next2.map((arg, index) => {
  if (index === 0) return arg;
  if (isExecPath(arg)) return "node";
  return arg;
});
const cleaned2 = [...filtered2];
for (let i = 2; i < cleaned2.length; ) {
  const arg = cleaned2[i];
  if (!arg || arg.startsWith("-")) {
    i += 1;
    continue;
  }
  if (isExecPath(arg)) {
    cleaned2[i] = "node";
    i += 1;
    continue;
  }
  break;
}
console.log("Fixed parsed:", cleaned2);

console.log("Commander looks at slice(2):");
console.log("Original slice(2):", cleaned1.slice(2));
console.log("Fixed slice(2):", cleaned2.slice(2));
