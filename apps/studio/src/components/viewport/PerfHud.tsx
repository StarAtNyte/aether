import { memo, type ReactElement } from 'react';
import { useUI } from '../../app/context';
import { compactCount, formatMs } from '../../lib/format';

/** Performance overlay (stats arrive at 4 Hz from the simulation, never per frame). */
export const PerfHud = memo(function PerfHud(): ReactElement | null {
  const show = useUI((s) => s.settings.showPerf);
  const stats = useUI((s) => s.stats);
  const backend = useUI((s) => s.backend);
  const mode = useUI((s) => s.mode);
  if (!show || !backend) return null;
  const fpsClass = stats.fps >= 50 ? 'is-good' : stats.fps >= 30 ? 'is-ok' : 'is-bad';
  return (
    <div className="perf-hud" aria-label="Performance">
      <div className={`perf-hud__fps ${fpsClass}`}>
        <strong>{stats.fps > 0 ? Math.round(stats.fps) : '–'}</strong>
        <span>fps{mode === 'edit' && stats.fps === 0 ? ' · idle' : ''}</span>
      </div>
      <dl>
        <div>
          <dt>frame</dt>
          <dd>{formatMs(stats.frameMs)}</dd>
        </div>
        <div>
          <dt>draws</dt>
          <dd>{compactCount(stats.drawCalls)}</dd>
        </div>
        <div>
          <dt>tris</dt>
          <dd>{compactCount(stats.triangles)}</dd>
        </div>
        <div>
          <dt>entities</dt>
          <dd>{compactCount(stats.entities)}</dd>
        </div>
        {mode === 'play' && (
          <>
            <div>
              <dt>bodies</dt>
              <dd>{compactCount(stats.bodies)}</dd>
            </div>
            <div>
              <dt>physics</dt>
              <dd>{formatMs(stats.stepMs)}</dd>
            </div>
          </>
        )}
        <div>
          <dt>gpu</dt>
          <dd>{backend === 'webgpu' ? 'WebGPU' : 'WebGL2'}</dd>
        </div>
        {stats.gpuMB > 0 && (
          <div title="Estimated GPU memory of the drawing buffers and shadow map">
            <dt>vram</dt>
            <dd>~{compactCount(stats.gpuMB)} MB</dd>
          </div>
        )}
        {stats.heapMB > 0 && (
          <div title="JavaScript heap in use">
            <dt>heap</dt>
            <dd>{compactCount(stats.heapMB)} MB</dd>
          </div>
        )}
      </dl>
    </div>
  );
});
