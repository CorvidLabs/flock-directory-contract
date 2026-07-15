const artifactNames = [
  'FlockDirectory.approval.teal',
  'FlockDirectory.arc32.json',
  'FlockDirectory.arc4.json',
  'FlockDirectory.clear.teal',
  'FlockDirectory.src_map.json',
] as const;

for (const artifactName of artifactNames) {
  const committed = await Bun.file(`artifacts/${artifactName}`).text();
  const compiled = await Bun.file(`dist/verification-artifacts/${artifactName}`).text();
  if (committed !== compiled) {
    throw new Error(`${artifactName} differs from the canonical TEALScript compilation output`);
  }
}

const committedArc56 = await Bun.file('artifacts/FlockDirectory.arc56.json').json();
const compiledArc56 = await Bun.file('dist/verification-artifacts/FlockDirectory.arc56.json').json();

delete committedArc56.compilerInfo;
delete compiledArc56.compilerInfo;

if (JSON.stringify(committedArc56) !== JSON.stringify(compiledArc56)) {
  throw new Error('FlockDirectory.arc56.json differs beyond local Algod compiler metadata');
}

console.log('Contract artifacts match canonical compilation output');
