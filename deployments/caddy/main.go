// The stock Caddy server with its standard modules, the same program the official
// image ships; the Dockerfile builds it with current Go and dependencies.
package main

import (
	caddycmd "github.com/caddyserver/caddy/v2/cmd"
	_ "github.com/caddyserver/caddy/v2/modules/standard"
)

func main() {
	caddycmd.Main()
}
