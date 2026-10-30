// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Button } from 'react-aria-components';
import { exportAuditLog } from '../api/endpoints.js';
import { isApiError, messageOf } from '../api/http.js';
import { Notice } from '../components/Notice.js';
import { PageHeading } from '../components/PageHeading.js';
import { saveBlob } from '../lib/download.js';
import { REAUTH_CANCELLED, useReauth } from '../session/ReauthProvider.js';

/**
 * Exportar la bitácora (2C §2.4): descarga JSON Lines con la cadena de hashes completa,
 * verificable fuera de la plataforma con `auditor-log verify`. Exige MFA reciente.
 */
export function AuditExportPage() {
  const { withReauth } = useReauth();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<{ fileName: string; chainId: string; bytes: number } | null>(null);

  const run = async () => {
    setBusy(true);
    setFailure(null);
    setResult(null);
    try {
      const exported = await withReauth(exportAuditLog);
      saveBlob(exported.blob, exported.fileName);
      setResult({ fileName: exported.fileName, chainId: exported.chainId, bytes: exported.blob.size });
    } catch (err) {
      setFailure(isApiError(err, REAUTH_CANCELLED) ? 'No se confirmó el código, así que no se exportó la bitácora.' : messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeading>Exportar bitácora</PageHeading>
      <p>
        La bitácora registra las acciones relevantes de la organización en una cadena de hashes: si alguien modifica o borra una entrada, la
        verificación lo detecta. La exportación incluye la cadena completa; las direcciones IP aparecen solo como HMAC. La propia exportación queda
        registrada como última línea del archivo.
      </p>
      <div className="actions">
        <Button className="button button-primary" isDisabled={busy} onPress={() => void run()}>
          {busy ? 'Exportando…' : 'Exportar bitácora'}
        </Button>
      </div>
      {failure !== null && (
        <Notice tone="error">
          {failure} Si la descarga se cortó, repita la exportación: un archivo incompleto no pasa la verificación.
        </Notice>
      )}
      {result !== null && (
        <section aria-labelledby="verificar" className="card">
          <Notice tone="success">{`Se descargó ${result.fileName} (${result.bytes.toLocaleString('es-CL')} bytes).`}</Notice>
          <h2 id="verificar">Cómo verificar la integridad</h2>
          <p>
            Identificador de la cadena: <code className="mono">{result.chainId}</code>
          </p>
          <p>En un equipo con la herramienta independiente instalada, ejecute:</p>
          <pre className="mono command">{`auditor-log verify --entries ${result.fileName} --chain-id ${result.chainId}`}</pre>
          <p>
            El resultado esperado es <q>RESULTADO: bitácora íntegra.</q> Sin anclajes externos no se detecta una reescritura completa de la bitácora;
            con ellos agregue <code className="mono">--anchors</code> y <code className="mono">--public-key</code> (vea{' '}
            <code className="mono">auditor-log --help</code> y la guía de verificación de integridad).
          </p>
        </section>
      )}
    </>
  );
}
