/**
 * What a PHP must carry to run the fiscal service outside its Docker image
 * (FUT-4717: a desktop install bundles a static PHP): the minor version and
 * the extensions, the same list as `sidecar/extensions.json`
 * (`@12-apps/fiscal/sidecar/extensions.json`), which `sidecar/bin/check-platform.php`
 * checks a PHP against and a PHPUnit test keeps equal to every `ext-*` the
 * service and its locked libraries require. A test keeps this copy equal to
 * the file.
 *
 * Launch it bound to the loopback only, with a token minted per launch:
 *
 * ```sh
 * FISCAL_SIDECAR_TOKEN=<random, 32+ chars> php -S 127.0.0.1:<port> -t sidecar/public sidecar/public/index.php
 * ```
 */

export const SIDECAR_PHP_VERSION = "8.3";

export const SIDECAR_PHP_EXTENSIONS = [
  "curl",
  "dom",
  "filter",
  "json",
  "libxml",
  "mbstring",
  "openssl",
  "reflection",
  "simplexml",
  "soap",
  "zlib",
] as const;

export type SidecarPhpExtension = (typeof SIDECAR_PHP_EXTENSIONS)[number];
