const fs = require('fs');

const svg = fs.readFileSync('s:/DogBotReborn/frontend/templates/infos.svg', 'utf8');

// Extrair dimensões
const widthMatch = svg.match(/width="([0-9.]+)"/);
const heightMatch = svg.match(/height="([0-9.]+)"/);
const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);

console.log('=== DIMENSÕES ===');
console.log('Width:', widthMatch ? widthMatch[1] : 'N/A');
console.log('Height:', heightMatch ? heightMatch[1] : 'N/A');
console.log('ViewBox:', viewBoxMatch ? viewBoxMatch[1] : 'N/A');

// Procurar por paths com transform para entender o layout
const transforms = [...svg.matchAll(/transform="matrix\(([^)]+)\)"/g)];
console.log('\n=== TRANSFORMS (primeiros 10) ===');
transforms.slice(0, 10).forEach((match, i) => {
  console.log(`${i + 1}: matrix(${match[1]})`);
});

console.log('\n=== TOTAL DE ELEMENTOS ===');
console.log('Paths:', (svg.match(/<path/g) || []).length);
console.log('Rects:', (svg.match(/<rect/g) || []).length);
console.log('Groups:', (svg.match(/<g/g) || []).length);
console.log('Transforms:', transforms.length);
