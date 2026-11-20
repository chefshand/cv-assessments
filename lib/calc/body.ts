/** Mosteller BSA in m^2. */
export const bsaMosteller = (heightCm: number, weightKg: number): number =>
  Math.sqrt((heightCm * weightKg) / 3600);

export const bmi = (heightCm: number, weightKg: number): number => weightKg / Math.pow(heightCm / 100, 2);
