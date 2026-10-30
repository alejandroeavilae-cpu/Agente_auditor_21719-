// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo } from 'react';
import { qrPath } from '../lib/qr.js';

/** Código QR dibujado como SVG propio (sin `innerHTML` ni `data:`), con margen de 4 módulos. */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, d } = useMemo(() => qrPath(value), [value]);
  const quiet = 4;
  const box = size + quiet * 2;
  return (
    <svg className="qr" role="img" aria-label={label} viewBox={`${String(-quiet)} ${String(-quiet)} ${String(box)} ${String(box)}`} shapeRendering="crispEdges">
      <rect x={-quiet} y={-quiet} width={box} height={box} fill="#ffffff" />
      <path d={d} fill="#000000" />
    </svg>
  );
}
