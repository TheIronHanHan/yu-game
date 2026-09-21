export const COLORS = {
  backgroundTop: '#13172F',
  backgroundBottom: '#090C1E',
  panel: '#202646',
  text: '#F7F7FF',
  subtext: '#B8BED4',
  muted: '#7F879F',
};

export function drawRoundedRect(ctx, x, y, width, height, radius, fill) {
  const limitedRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + limitedRadius, y);
  ctx.arcTo(x + width, y, x + width, y + height, limitedRadius);
  ctx.arcTo(x + width, y + height, x, y + height, limitedRadius);
  ctx.arcTo(x, y + height, x, y, limitedRadius);
  ctx.arcTo(x, y, x + width, y, limitedRadius);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

export function drawMine(ctx, centerX, centerY, radius, fill, detail) {
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.strokeStyle = fill;
  ctx.lineWidth = Math.max(2, radius * 0.2);
  ctx.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * radius * 0.75, Math.sin(angle) * radius * 0.75);
    ctx.lineTo(Math.cos(angle) * radius * 1.25, Math.sin(angle) * radius * 1.25);
    ctx.stroke();
  }
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = detail;
  ctx.beginPath();
  ctx.arc(-radius * 0.3, -radius * 0.3, radius * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawSpark(ctx, centerX, centerY, radius, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY - radius);
  ctx.lineTo(centerX + radius * 0.28, centerY - radius * 0.28);
  ctx.lineTo(centerX + radius, centerY);
  ctx.lineTo(centerX + radius * 0.28, centerY + radius * 0.28);
  ctx.lineTo(centerX, centerY + radius);
  ctx.lineTo(centerX - radius * 0.28, centerY + radius * 0.28);
  ctx.lineTo(centerX - radius, centerY);
  ctx.lineTo(centerX - radius * 0.28, centerY - radius * 0.28);
  ctx.closePath();
  ctx.fill();
}

export function drawArrow(ctx, centerX, centerY, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(centerX - 5, centerY);
  ctx.lineTo(centerX + 5, centerY);
  ctx.lineTo(centerX + 1, centerY - 4);
  ctx.moveTo(centerX + 5, centerY);
  ctx.lineTo(centerX + 1, centerY + 4);
  ctx.stroke();
}

export function fitText(ctx, text, centerX, y, maxWidth) {
  let output = text;
  while (ctx.measureText(output).width > maxWidth && output.length > 2) {
    output = `${output.slice(0, -2)}…`;
  }
  ctx.fillText(output, centerX, y);
}
