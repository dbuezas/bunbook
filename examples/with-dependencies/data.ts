// Generate some noisy data
export const xs = Array.from({ length: 50 }, (_, i) => i);
export const ys = xs.map((x) =>
  Math.round(2 * x + 10 + (Math.random() - 0.5) * 20)
);
