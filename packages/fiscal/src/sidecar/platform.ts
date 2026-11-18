/**
 * What a PHP must carry to run the fiscal service outside its Docker image
 * (FUT-4717: a desktop install bundles a static PHP): the minor version and
 * the extensions, the same list as `sidecar/extensions.json`
 * (`@12-apps/fiscal/sidecar/extensions.json`), which `sidecar/bin/check-platform.php`
 * checks a PHP against and a PHPUnit test keeps equal to every `ext-*` the
 * service and its locked libraries require. A test keeps this copy equal to
 * the file.
 *
 * Launch it bound to the loopback only, with a token minted per launch and
 * the image's safety settings as `-d` flags ({@link SIDECAR_PHP_LAUNCH_FLAGS}):
 *
 * ```sh
 * FISCAL_SIDECAR_TOKEN=<random, 32+ chars> php -d display_errors=0 -d log_errors=1 \
 *   -d zend.exception_ignore_args=1 -d zend.exception_string_param_max_len=0 -d file_uploads=0 \
 *   -S 127.0.0.1:<port> -t sidecar/public sidecar/public/index.php
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

/**
 * What the image's `docker/php.ini` guarantees, which a bundled PHP gets only
 * from its launch line (`extensions.json`'s `ini`): no error printed into a
 * response (the issuer would read it as an unanswered call), a stack trace
 * with no arguments (a password, a certificate, the launch token), no upload
 * spooled to disk. `-d` flags, not `-c docker/php.ini`: that file logs to
 * `/dev/stderr`, which a Windows desktop does not have.
 */
export const SIDECAR_PHP_SETTINGS = {
  display_errors: "0",
  log_errors: "1",
  "zend.exception_ignore_args": "1",
  "zend.exception_string_param_max_len": "0",
  file_uploads: "0",
} as const;

/** {@link SIDECAR_PHP_SETTINGS} as the argv a launcher puts before `-S` (and before `bin/check-platform.php`). */
export const SIDECAR_PHP_LAUNCH_FLAGS: readonly string[] = Object.entries(SIDECAR_PHP_SETTINGS).flatMap(([name, value]) => ["-d", `${name}=${value}`]);
