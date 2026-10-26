// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Compilación propia de Caddy (Apache-2.0) para controlar la versión del compilador Go
// y de sus dependencias: la imagen oficial caddy:2-alpine incluía vulnerabilidades altas
// del runtime de Go con corrección disponible (regla D-24). Solo módulos estándar.
package main

import (
	caddycmd "github.com/caddyserver/caddy/v2/cmd"

	_ "github.com/caddyserver/caddy/v2/modules/standard"
)

func main() {
	caddycmd.Main()
}
