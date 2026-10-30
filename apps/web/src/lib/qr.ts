// SPDX-License-Identifier: AGPL-3.0-or-later

import QRCode from 'qrcode';

/**
 * Código QR del URI `otpauth://` generado en el navegador con `qrcode` (sin servicios
 * externos). Se devuelve la matriz como un único trazado SVG que React dibuja como elementos
 * propios: no se usa `innerHTML` ni imágenes `data:`, compatible con la CSP estricta.
 */
export interface QrPath {
  /** Lado de la matriz en módulos, sin el margen. */
  size: number;
  /** Atributo `d` del trazado: un cuadrado de 1×1 por cada módulo oscuro. */
  d: string;
}

export function qrPath(text: string): QrPath {
  // Corrección de errores M: buen equilibrio entre tamaño y lectura con cámaras de teléfono.
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const parts: string[] = [];
  for (let row = 0; row < modules.size; row += 1) {
    for (let col = 0; col < modules.size; col += 1) {
      if (modules.get(row, col) === 1) parts.push(`M${String(col)} ${String(row)}h1v1h-1z`);
    }
  }
  return { size: modules.size, d: parts.join('') };
}
