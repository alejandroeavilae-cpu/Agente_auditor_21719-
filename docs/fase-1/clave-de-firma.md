# Crear la clave de firma de versiones del proyecto (pendiente P-12)

**Quién:** el responsable del proyecto. **Por qué usted y no un agente de IA:** la clave privada de firma es el ancla de confianza de todas las versiones; no debe pasar por ningún chat ni sistema intermedio. Solo usted y el secreto cifrado de GitHub la tendrán.

Tiempo estimado: 10 minutos.

## Paso 1 — Generar el par de claves en su computador

En Git Bash (Windows) o una terminal (Linux/macOS), dentro de una carpeta **fuera** del repositorio:

```sh
mkdir -p ~/claves-auditor && cd ~/claves-auditor
openssl ecparam -genkey -name prime256v1 -noout | openssl pkcs8 -topk8 -nocrypt -out auditor-21719-release.key.pem
openssl ec -in auditor-21719-release.key.pem -pubout -out auditor-21719-release.pub
```

Compruebe que existen dos archivos: `auditor-21719-release.key.pem` (**privada**) y `auditor-21719-release.pub` (pública).

## Paso 2 — Guardar la clave privada como secreto de GitHub

1. Abra https://github.com/alejandroeavilae-cpu/Agente_auditor_21719-/settings/secrets/actions
2. Clic en **New repository secret**.
3. Name: `COSIGN_SIGNING_KEY_PEM`
4. Secret: abra `auditor-21719-release.key.pem` con un editor de texto, copie **todo** el contenido (incluidas las líneas `-----BEGIN PRIVATE KEY-----` y `-----END PRIVATE KEY-----`) y péguelo.
5. Clic en **Add secret**.

## Paso 3 — Respaldar la clave privada

Guarde `auditor-21719-release.key.pem` en un medio fuera de línea (por ejemplo, un pendrive cifrado guardado en un lugar seguro). Si la pierde no se pierden datos, pero tendrá que crear una clave nueva y anunciar el cambio (rotación).

## Paso 4 — Publicar la clave pública

Copie `auditor-21719-release.pub` a `deploy/keys/auditor-21719-release.pub` en el repositorio y súbala con un commit firmado con DCO:

```sh
git add deploy/keys/auditor-21719-release.pub
git commit -s -m "chore: clave pública de firma de versiones"
git push
```

Desde ese momento, el workflow de publicación firma con la clave del proyecto en lugar de una clave efímera de prueba.
