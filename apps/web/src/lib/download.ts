// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Entrega un archivo generado en el navegador (códigos de recuperación, exportación de la
 * bitácora) mediante un enlace temporal `blob:`. No pasa por el servidor ni por el
 * almacenamiento del navegador; el enlace se revoca enseguida.
 */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Se revoca después del clic para que el navegador alcance a iniciar la descarga.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}

/** Texto de los códigos de recuperación para guardar (sin datos de la sesión). */
export function recoveryCodesText(codes: readonly string[], organization: string, issuedAt: Date): string {
  return [
    'Auditor 21719: códigos de recuperación de la verificación en dos pasos',
    `Organización: ${organization}`,
    `Generados: ${issuedAt.toISOString()}`,
    '',
    'Cada código sirve UNA sola vez si pierde acceso a su app autenticadora.',
    'Guárdelos en un lugar seguro (p. ej. un gestor de contraseñas). No los comparta.',
    '',
    ...codes,
    '',
  ].join('\n');
}
