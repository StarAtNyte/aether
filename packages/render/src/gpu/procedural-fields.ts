/** Fixed immutable noise fields reused across environments and renderer instances. */
import { fractalNoise, CLOUD_TEXTURE_SIZE, CLOUD_SEED } from '../environment/cloud-noise';
import { noisePixels, NOISE_SIZE } from '../materials/noise-pixels';

export interface ProceduralFields { cloud: Float32Array; cirrus: Float32Array; material: Uint8Array }
const fields: Partial<ProceduralFields> = {};
export function createProceduralFields(): ProceduralFields {
  return { cloud: fractalNoise(CLOUD_TEXTURE_SIZE, CLOUD_SEED), cirrus: fractalNoise(CLOUD_TEXTURE_SIZE, CLOUD_SEED + 7, 4), material: noisePixels() };
}
export function proceduralFieldsReady(): boolean { return !!fields.cloud && !!fields.cirrus && !!fields.material; }
export function installProceduralFields(value: unknown): boolean {
  const f = value as Partial<ProceduralFields> | null;
  if (!(f?.cloud instanceof Float32Array) || f.cloud.length !== CLOUD_TEXTURE_SIZE ** 2
    || !(f.cirrus instanceof Float32Array) || f.cirrus.length !== CLOUD_TEXTURE_SIZE ** 2
    || !(f.material instanceof Uint8Array) || f.material.length !== NOISE_SIZE ** 2 * 4) return false;
  // A synchronous consumer may have populated one field while the worker was running.
  fields.cloud ??= f.cloud; fields.cirrus ??= f.cirrus; fields.material ??= f.material;
  return true;
}
export function cloudNoiseField(cirrus: boolean): Float32Array {
  return cirrus ? (fields.cirrus ??= fractalNoise(CLOUD_TEXTURE_SIZE, CLOUD_SEED + 7, 4)) : (fields.cloud ??= fractalNoise(CLOUD_TEXTURE_SIZE, CLOUD_SEED));
}
export function materialNoiseField(): Uint8Array { return fields.material ??= noisePixels(); }
