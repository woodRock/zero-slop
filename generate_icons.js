const fs = require('fs');
const { createCanvas } = require('canvas');

const sizes = [16, 48, 128];

sizes.forEach(size => {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#1D9BF0';
  ctx.beginPath();
  const radius = size * 0.2;
  ctx.roundRect(0, 0, size, size, radius);
  ctx.fill();

  // Z Text
  ctx.fillStyle = 'white';
  ctx.font = `bold ${Math.floor(size * 0.7)}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Z', size / 2, size / 2 + (size * 0.05));

  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(`icons/icon${size}.png`, buffer);
  console.log(`Generated icon${size}.png`);
});
