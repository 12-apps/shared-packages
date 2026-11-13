# The fiscal service (`sidecar/`)

A thin, stateless HTTP door in front of
[`nfephp-org/sped-nfe`](https://github.com/nfephp-org/sped-nfe), a PHP library
that builds, signs and transmits NF-e (model 55) and NFC-e (model 65). It ships
inside `@12-apps/fiscal` with its own `Dockerfile`, so a host builds the image
from the version it pins:

```bash
docker build -t fiscal-sidecar node_modules/@12-apps/fiscal/sidecar
```

The TypeScript side of the contract is in the same package:
`@12-apps/fiscal/sale` (the document, `SaleForDocument`),
`@12-apps/fiscal/sidecar` (each endpoint's request and answer, the error
classes) and `@12-apps/fiscal/sidecar/schema/sale-for-document.schema.json`
(the JSON schema this service validates every document against).

## Endpoints

JSON in, JSON out. `<model>` is `nfe` or `nfce`. Every call that talks to
SEFAZ carries `environment` (`homologacao` | `producao`) and `certificate`
(`{ pfxBase64, password }`, the A1).

| endpoint | does | answers |
|---|---|---|
| `POST /<model>/issue` | `{ environment, certificate, csc, document }`: builds, signs and transmits. `csc` (`{ id, token }`) is required for `nfce` and must be `null` for `nfe`. | `AUTHORIZED` or `DENIED` (a denial of use: the number is spent): `accessKey`, `protocol`, `authorizedAt`, `signedXml`, `authorizedXml` (the `nfeProc`), `statusCode`, `statusReason`, `sefazReply` |
| `POST /nfce/sign-contingency` | the same, plus `contingency: { since, reason }`; builds and signs with `tpEmis = 9`, sends nothing | `SIGNED`: `accessKey`, `signedXml` |
| `POST /<model>/transmit` | `{ environment, certificate, signedXml }` | as `/issue` |
| `POST /<model>/cancel` | `{ environment, certificate, accessKey, protocol, reason }` | `CANCELLED`: the event's `protocol`, `registeredAt`, `eventXml` (each `null` when a retried cancel is settled by a lookup that does not carry them) |
| `POST /<model>/lookup` | `{ environment, certificate, accessKey }` | `AUTHORIZED`, `CANCELLED`, `DENIED` or `NOT_FOUND`, with the authorisation `protocol` |
| `POST /inutilize` | `{ environment, certificate, model, uf, cnpj, year, series, from, to, reason }` | `INUTILIZED`: `protocol`, `registeredAt`, `inutilizationXml` (`protocol` and the XML `null` on a retry SEFAZ answers 563) |
| `GET /health` | | `{ status: "ok", libraries, nfeSchemas, sefazTlsVerify }` |

The UF and the issuer of `cancel` and `lookup` are read from the access key.
The `document.keyCode` (`cNF`) is the caller's, drawn once and kept, so a
retried `issue` yields the same key.

**Retrying is safe, and answers like the first call.** SEFAZ's "already done"
codes are settled, not reported: 204 (the key is already authorised) and 205
(already denied) on `issue`/`transmit` look the key up and answer `AUTHORIZED`
or `DENIED` (a different document under the same key stays `REJECTED`); 218
(already cancelled) and 573 (duplicate event) on `cancel` answer `CANCELLED`;
563 (same range already requested) on `/inutilize` answers `INUTILIZED`.

**A request that went out and got no answer** (an empty reply, a receive
error or a timeout after the upload, HTTP 5xx) is settled by looking the key
up FIRST, and the lookup's answer is the answer. Only when the lookup cannot
reach SEFAZ either does an NFC-e being issued answer `CONTINGENCY` (with
`outcomeUnknown: true`); everywhere else it is `RETRYABLE`. A blind
contingency could put a second document on the same sale.

**Layout limit.** A document issued on or after 2027-01-01 is refused as
`INVALID` with code `NT_2026_008_NOT_SUPPORTED`: from 2027 the IBS/CBS go
inside `vProd` and the net price travels in NT 2026.008's `vProdLiq`, which
sped-nfe 5.2.9 cannot write.

## Errors

Every failure is `{ error: { class, code, message, details, accessKey, signedXml, sefazReply, outcomeUnknown } }`:

| class | HTTP | when |
|---|---|---|
| `REJECTED` | 422 | SEFAZ said no; `code` is its `cStat`. The number is not spent (a denial answers `DENIED`, not an error). |
| `RETRYABLE` | 503 | try again: nothing reached SEFAZ outside NFC-e issuing, a receipt with no protocol yet (103, 105), SEFAZ unable to reach a revocation list (286, 296), rate limiting (656), 999, SEFAZ stopped (108, 109) outside issuing, a reply with no status, a 4xx that is not SEFAZ's. With `outcomeUnknown: true`, look the key up before sending again. |
| `CONTINGENCY` | 503 | issuing an NFC-e: nothing reached SEFAZ, or SEFAZ is stopped (108, 109), or a request with no answer could not be settled by a lookup. Go offline through `/nfce/sign-contingency`. **On an NF-e (model 55)** there is no offline path in this service (no SVC, no EPEC): only 108/109 answer `CONTINGENCY` there, and the host treats it as "retry later". |
| `AUTH` | 401 | the `.pfx` does not open (wrong password, not PKCS#12), the certificate expired, the client certificate was refused at the TLS handshake or by an HTTP 403 from a verified SEFAZ host, or by code (213, 280–285, 290–295). Codes from sped-nfe's `storage/cstat.json`. |
| `INVALID` | 400 | the request is malformed: the schema, a missing CSC, an XML the layout's XSD refuses, a quantity with more than four decimals, a document past the layout limit. Never retry it as is. |
| `INTERNAL` | 500 | a defect of the service; a retry would repeat it. |

When the call got as far as signing, `accessKey` and `signedXml` come back
with the error: the key is spoken for, and an NFC-e can be signed offline.

## Stateless, and quiet about secrets

- The certificate, its password and the CSC arrive with each call and leave
  with it. The kernel is built per request; no class holds static state.
- Nothing is written to disk. sped-common's own SOAP transport writes the
  private key to a temporary folder before every request; this service gives
  cURL the key in memory instead (`CURLOPT_SSLKEY_BLOB`). The image runs with a
  read-only root filesystem (Apache's pid needs a tmpfs at `/var/run/apache2`).
- The request log is one JSON line per call on stderr: time, method, path,
  status, duration, error class and SEFAZ code. Nothing read from the body is
  ever in it, and stack traces carry no arguments
  (`zend.exception_ignore_args`).

## Configuration

| variable | default | |
|---|---|---|
| `FISCAL_SEFAZ_TIMEOUT_SECONDS` | `30` | connect timeout, TLS handshake included; the whole request gets 20 s more |
| `FISCAL_SEFAZ_TLS_VERIFY` | on | SEFAZ's server certificate is verified. `off` is the only value that turns it off, and `/health` then reports `sefazTlsVerify: false`. Unverified, anyone on the path reads every document and can forge SEFAZ's answers. |
| `FISCAL_SEFAZ_CA_BUNDLE` | the image's | a PEM replacing the trust store. The image builds `/etc/ssl/fiscal-sidecar-ca.pem` from its Mozilla bundle plus `docker/icp-brasil.pem` (the ICP-Brasil roots and intermediates ITI publishes, sha256-checked in the Dockerfile): some SEFAZ hosts present ICP-Brasil server certificates, others public ones. Outside the image the system bundle plus that PEM are used. |

The image listens on 8080 as `www-data`, and its `HEALTHCHECK` calls `/health`.
Apache prefork runs at most four workers and PHP caps a request at 128M
(`docker/mpm.conf` argues the numbers: a 990-item NF-e peaks at 36 MB), so the
service needs at most about 512M; a compose memory limit of 640M leaves Apache
its parent process.
OpenSSL's legacy provider is on, because most A1 files issued before 2023 are
encrypted with RC2-40.

## A second library

Each library is a `Module` that registers its own paths
(`src/Nfe/NfeModule.php`). An NFS-e library is a second module, with its
`/nfse/...` paths, appended in `Kernel::modules()`; the router refuses a path
registered twice.

## Tests

```bash
composer install            # in this folder
vendor/bin/phpunit --testsuite unit
vendor/bin/phpunit --testsuite live   # skips without the variables below
```

The unit suite needs no certificate: it makes a throwaway self-signed A1 in
the test (never written to the repository), validates the signed XML against
the schema package's XSD, plays recorded SEFAZ replies
(`tests/fixtures/sefaz/`), boots the service with `php -S` to read its request
log after a wrong password, checks that no call writes a file, and drives the
real cURL transport against a local TLS server that never accepts, drops or
hangs after the upload, or refuses the client certificate. CI runs it on every
change under `sidecar/`, and builds the image.

The live suite runs the acceptance against SEFAZ homologação with a real A1 of
a CNPJ accredited for NFC-e: `FISCAL_TEST_PFX_BASE64`,
`FISCAL_TEST_PFX_PASSWORD`, `FISCAL_TEST_CSC`, `FISCAL_TEST_CSC_ID`,
`FISCAL_TEST_CNPJ`, `FISCAL_TEST_UF`; optionally `FISCAL_TEST_IE`,
`FISCAL_TEST_MUNICIPALITY_IBGE`, `FISCAL_TEST_MUNICIPALITY`,
`FISCAL_TEST_TAX_REGIME`, `FISCAL_TEST_SERIES` (default 889), and
`FISCAL_TEST_BASE_URL` to drive a running service. It runs with SEFAZ's
certificate verified, so its first pass also proves the trust store. Mutual
TLS cannot cross an intercepting proxy, so run it where the machine reaches
SEFAZ directly.

## Versions

sped-nfe `5.2.9`, schema package `PL_010_V1.30` (Pacote de Liberação 010f: NT
2025.002 v1.50 and NT 2026.007 v1.00). NT 2026.008's `vProdLiq` and
`vProdLiqTot`, needed when the IBS/CBS move inside `vProd` in 2027, are on
sped-nfe's `master` after 5.2.9 and arrive with its next release.
